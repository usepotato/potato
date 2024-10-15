import asyncio
import base64
from datetime import datetime, timedelta
from enum import Enum
import enum
import json
import asyncio
import aiohttp
from pydantic import BaseModel
from shinpads_browser.lib.browser_util import get_elements_from_action
from shinpads_browser.lib.helper import get_base_url
from shinpads_browser.lib.logger import get_logger
from pyppeteer import connect
from pyppeteer.browser import Browser
from pyppeteer.page import Page
import pyppeteer.page
from pyppeteer.target import Target
from pyppeteer.frame_manager import Frame
import pyppeteer.errors
import socketio
from app.redis import redis_client
import urllib.parse

with open('shinpads_browser/lib/browser_page_scripts.js', 'r') as f:
  browser_page_scripts = f.read()

logger = get_logger(__name__)

class BrowserUpdateType(str, Enum):
  DOM = 'dom'
  PAGE = 'page'
  PAGE2 = 'page2'
  CONSOLE = 'console'
  NETWORK = 'network'
  MUTATION = 'mutation'
  RESIZE = 'resize'
  SCROLL = 'scroll'
  CLICK = 'click'
  RELOAD = 'reload'
  NAVIGATE = 'navigate'
  GO_BACK = 'go-back'
  GO_FORWARD = 'go-forward'
  MOUSEMOVE = 'mousemove'
  INPUT = 'input'
  KEYDOWN = 'keydown'
  ADD_STYLE = 'add-style'
  REMOVE_STYLE = 'remove-style'
  LOADING = 'loading'


class BrowserServiceUpdateType(str, Enum):
  WEB_FLOW_STARTED = 'web-flow-started'
  WEB_FLOW_COMPLETED = 'web-flow-completed'
  WEB_FLOW_FAILED = 'web-flow-failed'
  BROWSER_SESSION_ENDED = 'browser-session-ended'


class BrowserUpdate(BaseModel):
  type: BrowserUpdateType
  data: str | dict | list | None | bool = None

class BrowserServiceUpdate(BaseModel):
  type: BrowserServiceUpdateType
  data: str | dict | list | None | bool = None

class BrowserState(str, enum.Enum):
  available = 'available'
  busy = 'busy'
  offline = 'offline'

class BrowserInfo(BaseModel):
  base_url: str
  state: BrowserState
  class Config:
    use_enum_values = True

class ShinpadsBrowser:
  def __init__(self, worker_url: str, sio: socketio.AsyncServer = None):
    self.worker_url = worker_url
    self.worker_id = worker_url.replace('/', '_').replace(':', '_')
    self.browser: Browser = None
    self.connected = False
    self.browser_session_id = None
    self.sio = sio
    self.subscribed_socket_id: str = None
    self.is_loading = False
    self.socket_disconnect_at = None
    self.state_check_task: asyncio.Task | None = None
    self.request_cache = {}
    self.is_shutting_down = False
    self.base_url = None

  async def _set_available(self):
    logger.info(f'Setting browser {self.worker_id} to available at {self.base_url}')
    await redis_client.set(f'browser:{self.worker_id}', BrowserInfo(state=BrowserState.available, base_url=self.base_url).model_dump_json())
    await redis_client.sadd('browser:available', self.worker_id)

  async def _set_busy(self):
    await redis_client.set(f'browser:{self.worker_id}', BrowserInfo(state=BrowserState.busy, base_url=self.base_url).model_dump_json())
    await redis_client.srem('browser:available', self.worker_id)

  async def _set_offline(self):
    await redis_client.delete(f'browser:{self.worker_id}')
    await redis_client.srem('browser:available', self.worker_id)

  async def state_checker(self):
    while not self.is_shutting_down:
      await asyncio.sleep(1)
      if self.browser_session_id and not self.subscribed_socket_id:
        if self.socket_disconnect_at and datetime.now() - self.socket_disconnect_at > timedelta(seconds=15):
          logger.info(f'Disconnecting browser due to 15s inactivity')
          await self.end_session()

      if not self.connected:
        logger.info(f'Browser not connected, relaunching...')
        await self.launch()

  async def run_web_flow(self, web_flow_run_id: str, web_flow: dict):
    logger.info(f'Running web flow: {web_flow["id"]}')

    await self.send_service_update_to_subscribers(BrowserServiceUpdate(type=BrowserServiceUpdateType.WEB_FLOW_STARTED, data={
      'web_flow_run_id': web_flow_run_id,
      'browser_session_id': self.browser_session_id,
      'timestamp': datetime.now().isoformat(),
    }))

    # simulate running
    logger.info(f'Processing web flow... {web_flow["id"]}')

    page = await self.get_page()
    await page.goto(web_flow['start_url'], {'waitUntil': 'networkidle0'})

    for action in web_flow['actions']:
      logger.info(f'Processing action: {action["id"]}')
      if action['parameter']['type'] == 'click':
        elements = await get_elements_from_action(action, page)
        for element in elements:
          logger.info(f'Clicking on element: {element.toString()}')
          await element.click()
          await asyncio.sleep(0.5)
      # elif action.parameter.type == WebFlowActionType.INPUT:
      #   await page.type(action.selector, action.value)


    logger.info(f'Completed web flow... {web_flow["id"]}')

    await self.send_service_update_to_subscribers(BrowserServiceUpdate(type=BrowserServiceUpdateType.WEB_FLOW_COMPLETED, data={
      'web_flow_run_id': web_flow_run_id,
      'browser_session_id': self.browser_session_id,
      'timestamp': datetime.now().isoformat(),
      'response': None
    }))


  async def get_page(self) -> Page:
    pages = await self.browser.pages()
    if len(pages) == 0:
      page = await self.browser.newPage()
      return page
    return pages[0]

  async def close(self):
    self.is_shutting_down = True
    if self.browser:
      await self.browser.disconnect()
    await self.on_disconnected()

  async def end_session(self):
    logger.info(f'Ending session for {self.browser_session_id}')
    if self.browser_session_id:
      logger.info(f'Sending browser session ended update for {self.browser_session_id}')
      await self.send_service_update_to_subscribers(BrowserServiceUpdate(type=BrowserServiceUpdateType.BROWSER_SESSION_ENDED, data={
        'browser_session_id': self.browser_session_id,
        'timestamp': datetime.now().isoformat(),
      }))

    logger.info(f'Cleaning up browser session {self.browser_session_id}')
    self.browser_session_id = None
    self.socket_disconnect_at = None

    if self.connected:
      # cleanup browser
      for page in await self.browser.pages():
        await page.close()
      await self._set_available()

    try:
      await self.sio.disconnect(sid=self.subscribed_socket_id)
    except Exception as e:
      logger.warning(f'An error occurred while disconnecting socket: {e}', exc_info=True)

  async def on_disconnected(self):
    await self._set_offline()
    self.connected = False
    logger.info(f"Browser disconnected: {self.worker_url}")
    await self.end_session()
    self.state_check_task.cancel()
    try:
      await self.state_check_task
    except asyncio.CancelledError:
      pass

  async def launch(self):
    self.base_url = await get_base_url()
    async def fetch_browser_data():
      logger.info(f'Fetching browser data')
      async with aiohttp.ClientSession() as session:
        try:
          async with session.get('http://localhost:9222/json/version') as response:
            if response.status == 200:
              return await response.json()
        except aiohttp.ClientError as e:
          logger.warning(f"could not find browser at http://localhost:9222...")
          return None
    browser_data = await fetch_browser_data()
    if not browser_data:
      return

    ws_url = browser_data['webSocketDebuggerUrl']

    self.browser = await connect(browserWSEndpoint=ws_url)

    logger.info(f'Connected to browser {self.browser.wsEndpoint}')

    def on_shinpads_update(msg):
      try:
        async def run(msg):
          try:
            data = json.loads(msg)
            try:
              data = json.loads(data['args'][0])
            except Exception as e:
              pass

              await self.send_update_to_subscribers(BrowserUpdate(type=data['type'], data=data['data']))
          except Exception as e:
            logger.error(f"An error occurred while running on_shinpads_update: {data} {e}", exc_info=True)

        asyncio.ensure_future(run(msg))
      except Exception as e:
        logger.error(f"An error occurred while running on_shinpads_update: {msg} {e}", exc_info=True)

    async def on_response(response: pyppeteer.page.Response):
      content = None
      try:
        content = await response.buffer()
        content_type = response.headers.get('content-type', 'application/octet-stream')
        if len(content) > 0:
          self.request_cache[response.url] = (content, content_type)
      except Exception as e:
        pass
        # logger.warning(f'failed to cache response: {response.url} {content} {e}')

    async def on_target_created(target: Target):
      if target.type == 'page':
        page = await target.page()
        self.request_cache = {}
        async def on_framenavigated(frame: Frame):
          if page.mainFrame == frame:
            await self.send_update_to_subscribers(BrowserUpdate(type=BrowserUpdateType.LOADING, data={'loading': True }))

            await page.waitForSelector('body')
            # page.on('request', lambda request: asyncio.create_task(on_request(request)))
            # page.on('response', lambda response: asyncio.create_task(on_response(response)))
            try:
              await page.exposeFunction('shinpadsUpdate', on_shinpads_update)
            except pyppeteer.errors.PageError as e:
              pass

            await page.evaluate(f'window.browserSessionId = "{self.browser_session_id}"')
            await page.evaluate(browser_page_scripts)

        page.on('response', lambda response: asyncio.ensure_future(on_response(response)))
        page.on('framenavigated', lambda frame: asyncio.ensure_future(on_framenavigated(frame)))

    self.connected = True
    async def on_browser_disconnected():
      self.connected = False
      await self._set_offline()
      logger.info(f"Browser disconnected: {self.worker_url}")
      await self.end_session()
      if not self.is_shutting_down:
        logger.info(f'Browser disconnected?: relaunching...')
        await self.launch()

    self.browser.on('disconnected', lambda: asyncio.ensure_future(on_browser_disconnected()))
    self.browser.on('targetcreated', lambda target: asyncio.ensure_future(on_target_created(target)))

    logger.info(f'Closing all pages')
    for page in await self.browser.pages():
      logger.info(f'Closing page {page.url}')
      await page.close()

    page = await self.browser.newPage()

    await page._client.send('Network.clearBrowserCache')
    await page._client.send('Network.clearBrowserCookies')

    await page.goto('https://google.com')

    await self._set_available()

    if not self.state_check_task:
      self.state_check_task = asyncio.create_task(self.state_checker())

    logger.info(f"Browser started on {self.browser.wsEndpoint}")

  async def initialize_browser_session(self, browser_session_id: str):
    #TODO: should just close browser after a session is ended and creat ea new one here.

    await self._set_busy()
    self.browser_session_id = browser_session_id

    logger.info(f'Initializing browser session for {browser_session_id}')

    # clear everything on browser
    self.subscribed_socket_id = None
    for page in await self.browser.pages():
      await page.close()

    page = await self.browser.newPage()
    await page.goto('https://google.com')

    base_url = await get_base_url()

    return {
      'browser_session_id': browser_session_id,
      'base_url': base_url,
      'timestamp': datetime.now().isoformat(),
    }


  async def send_update_to_subscribers(self, update: BrowserUpdate):
    await self.sio.emit('browser-update', update.model_dump(), to=self.subscribed_socket_id)

  async def send_service_update_to_subscribers(self, update: BrowserServiceUpdate):
    await self.sio.emit('browser-service-update', update.model_dump(), to=self.subscribed_socket_id)

  async def send_page_content(self):
    try:
      page = await self.get_page()
      await page.waitForSelector('body')
      # page_content = await self.get_page_content(page, no_body=True)

      # await self.send_update_to_subscribers(BrowserUpdate(type=BrowserUpdateType.PAGE, data=page_content))

      await page.evaluate('window.sendPageContent()')

    except Exception as e:
      logger.error(f'An error occurred while sending page content: {e}', exc_info=True)

  async def receive_update(self, update: BrowserUpdate):
    try:
      page = await self.get_page()
      if update.type == BrowserUpdateType.RESIZE:
        await page.setViewport(update.data)
      if update.type == BrowserUpdateType.CLICK:
        await page.click(f'[shinpads-id="{update.data["shinpadsId"]}"]')
        logger.info(f'Clicked on {update.data["x"]}, {update.data["y"]}')
      if update.type == BrowserUpdateType.SCROLL:
        await page.evaluate(f'''() => {{
            window.scrollTo({update.data["x"]}, {update.data["y"]})
        }}''')
      if update.type == BrowserUpdateType.RELOAD:
        await page.reload()
      if update.type == BrowserUpdateType.NAVIGATE:
        url = update.data
        await page.goto(url)
      if update.type == BrowserUpdateType.GO_BACK:
        await page.goBack()
      if update.type == BrowserUpdateType.GO_FORWARD:
        await page.goForward()
      if update.type == BrowserUpdateType.MOUSEMOVE:
        await page.mouse.move(update.data['x'], update.data['y'])
      if update.type == BrowserUpdateType.INPUT:
        await page.evaluate(f'''() => {{
          const element = document.querySelector('[shinpads-id="{update.data["shinpadsId"]}"]');
          element.value = "{update.data["value"]}";
          element.dispatchEvent(new Event('input', {{ bubbles: true }}));
        }}''')
      if update.type == BrowserUpdateType.KEYDOWN:
        await page.keyboard.press(update.data['key'])

    except Exception as e:
      logger.error(f'An error occurred while receiving update: {e}', exc_info=True)

  async def get_static_resource(self, path: str, accept: str = None):
    page = await self.get_page()

    if path.startswith('/'):
      path = f'{page.url}{path}'
    if not path.startswith('http'):
      if not path.startswith('/'):
        path = f'/{path}'

      origin_url = urllib.parse.urlparse(page.url).scheme + '://' + urllib.parse.urlparse(page.url).netloc
      path = f'{origin_url}{path}'
    if self.request_cache.get(path, None):
      cached_content, cached_content_type = self.request_cache[path]
      if len(cached_content) > 0:
        logger.info(f'Returning cached content for {path}')
        return cached_content, cached_content_type

    data_url = await page.evaluate(f'''() => {{ return window.getBase64FromUrl("{path}") }}''')
    if data_url:
      content_type = data_url.split(":")[1].split(";")[0]
      image_data = data_url.split(",")[1]
      image_bytes = base64.b64decode(image_data)
      self.request_cache[path] = (image_bytes, content_type)
      return image_bytes, content_type

    else:
      for _ in range(15):
        await asyncio.sleep(0.2)
        if self.request_cache.get(path, None):
          return self.request_cache[path]

    return None, None

  async def subscribe_socket(self, socket_id: str):
    self.subscribed_socket_id = socket_id
    self.socket_disconnect_at = None
    await self.send_page_content()

  async def unsubscribe_socket(self, socket_id: str):
    self.subscribed_socket_id = None
    self.socket_disconnect_at = datetime.now()





<h1>
  <img src="./frontend/public/icon.png" with="28" height="28" style="margin: auto;">
  potato
</h1>
<p><a href="https://usepotato.com">potato</a> is an open source agentic web browser</p>

#### Video Demo
[![Video Demo](https://img.youtube.com/vi/Iw2ZzdzKap4/0.jpg)](https://www.youtube.com/watch?v=Iw2ZzdzKap4)


## Examples

### Simple web actions
```python
potato_client = Potato("POTATO_API_KEY")

potato = await potato_client.start_session()
await potato.navigate('https://papajohns.com')
await potato.act('click start order')

await potato.act('select delivery')
await potato.act('fill in my address')
await potato.act('click start order')

options = await potato.extract('available options')
await potato.act('add to order', option=options[0])

await potato.act('go to checkout page', multi_step=True)

await potato.end()
```

### Complex, general actions
```python
potato_client = Potato("POTATO_API_KEY")

potato = await potato_client.start_session()

await potato.job("List the pricing plans of the 5 most popular tax software products")

await potato.end()
```

### Tools
```python
potato_client = Potato("POTATO_API_KEY")

tools = [evaluate_relevance]

potato = await potato_client.start_session()

await potato.navigate('https://ycombinator.com/companies')
companies = await potato.extract("linkedin urls of any companies at least 80% relevant")

await potato.end()
```

### Monitoring
```python
potato_client = Potato("POTATO_API_KEY")

potato = await potato_client.start_session()

await potato.navigate('https://ycombinator.com/companies')

async for new_applicant in potato.monitor("new applicants" schema=db.Applicant):
  applicant = Applicant.model_validate(new_applicant)
  db.add(applicant)
  db.commit()

```


### Puppeteer/Playwright
```python
potato_client = Potato("POTATO_API_KEY")

potato = await potato_client.start_session()

async with async_playwright() as p:
  browser = await p.chromium.connect_over_cdp(
    ws_endpoint=potato.wsUrl,
  )

  page = await browser.new_page()
  await page.goto("https://usepotato.com")
  title = await page.title()
  print(title)

await potato.close()


```

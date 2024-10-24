<h1>
  <img src="./frontend/public/icon.png" with="28" height="28" style="margin: auto;">
  plato
</h1>
<p><a href="https://plato.so">plato</a> is an open source agentic web browser</p>


#### Video Demo
[![Video Demo](https://img.youtube.com/vi/uA40RLLkx7A/0.jpg)](https://www.youtube.com/watch?v=uA40RLLkx7A)


## Examples

### Simple web actions
```python
plato_client = plato("PLATO_API_KEY")

plato = await plato_client.start_session()
await plato.navigate('https://papajohns.com')
await plato.act('click start order')

await plato.act('select delivery')
await plato.act('fill in my address')
await plato.act('click start order')

options = await plato.extract('available options')
await plato.act('add to order', option=options[0])

await plato.act('go to checkout page', multi_step=True)

await plato.end()
```

### Complex, general actions
```python
plato_client = plato("PLATO_API_KEY")

plato = await plato_client.start_session()

await plato.job("List the pricing plans of the 5 most popular tax software products")

await plato.end()
```

### Tools
```python
plato_client = plato("PLATO_API_KEY")

tools = [evaluate_relevance]

plato = await plato_client.start_session()

await plato.navigate('https://ycombinator.com/companies')
companies = await plato.extract("linkedin urls of any companies at least 80% relevant")

await plato.end()
```

### Monitoring
```python
plato_client = plato("PLATO_API_KEY")

plato = await plato_client.start_session()

await plato.navigate('https://ycombinator.com/companies')

async for new_applicant in plato.monitor("new applicants" schema=db.Applicant):
  applicant = Applicant.model_validate(new_applicant)
  db.add(applicant)
  db.commit()

```


### Puppeteer/Playwright
```python
plato_client = plato("PLATO_API_KEY")

plato = await plato_client.start_session()

async with async_playwright() as p:
  browser = await p.chromium.connect_over_cdp(
    ws_endpoint=plato.wsUrl,
  )

  page = await browser.new_page()
  await page.goto("https://useplato.com")
  title = await page.title()
  print(title)

await plato.close()


```

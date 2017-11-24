# Logux Redis Store [WIP]

<img align="right" width="95" height="95" title="Logux logo"
     src="https://cdn.rawgit.com/logux/logux/master/logo.svg">

Logux Redis store, to be used with [logux-server](https://github.com/logux/logux-server).

```js
const Server = require('logux-server').Server
const RedisStore = require('logux-store-redis');

const app = new Server(
	Server.loadOptions(process, {
		subprotocol: '1.0.0',
		supports: '1.x',
		root: __dirname,
		store: new RedisStore(/* configuration */)
	})
)

app.auth((userId, token) => {
  // TODO Check token and return a Promise with true or false.
})

app.listen()
```

## Configuration
This module uses [ioredis](https://github.com/luin/ioredis), and the confguration is passed as is.

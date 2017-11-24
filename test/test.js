const RedisStore = require('..');

const eachTest = require('logux-store-tests')

let store;
afterEach(() => store ? store.destroy() : null);

eachTest((desc, creator) => {
  it(desc, creator(() => {
    store = new RedisStore({ db: 6 });
    return store;
  }))
})


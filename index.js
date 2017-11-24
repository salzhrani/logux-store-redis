const Redis = require('ioredis');
const isFirstOlder = require('logux-core/is-first-older');

module.exports = class RedisStore {
    constructor(...args) {
        this.redis = new Redis(...args);
    }
    async add(action, meta) {
        const logId = `${meta.id}`;
        const inserted = await this.redis.sadd('log_ids', logId);
        if (!inserted) {
            return false;
        }
        const added = await this.redis.incr('added');
        await Promise.all([
            this.redis.set(`added|${added}`, logId),
            this.redis.hmset(
                `logs|${logId}`,
                'action',
                JSON.stringify(action),
                'meta',
                JSON.stringify(meta),
                'time',
                JSON.stringify(meta.time),
                'created',
                `${meta.time}\t${meta.id.slice(1).join('\t')}\t${meta.id[0]}`,
                'added',
                added
            )
        ]);
        if (meta.reasons) {
            const args = meta.reasons.map(r => `${r}`);
            await this.redis.sadd(...[`reasons|${added}`].concat(args));
        }
        return Object.assign({}, meta, { added });
    }
    async has(id) {
        return null;
    }
    async remove(id) {
        const result = await this.redis.hmget(
            `logs|${id}`,
            'added',
            'action',
            'meta'
        );
        if (result && result[0] && result[1] && result[2]) {
            const added = JSON.parse(result[0]);
            await Promise.all([
                this.redis.del(
                    `logs|${id}`,
                    `reasons|${added}`,
                    `added|${added}`
                ),
                this.redis.srem('log_ids', `${id}`)
            ]);
            const meta = JSON.parse(result[2]);
            const action = JSON.parse(result[1]);
            meta.added = added;
            return [action, meta];
        }
        return false;
    }
    async getResults(order, offset) {
        const count = await this.redis.scard('log_ids');
        if (count <= offset) {
            return { entries: [] };
        }
        const args = [
            'log_ids',
            'BY',
            `logs|*->${order}`,
            'LIMIT',
            [offset, 100],
            'GET',
            'logs|*->action',
            'GET',
            'logs|*->meta',
            'GET',
            'logs|*->added',
            'DESC'
        ];
        if (order === 'created') {
            args.push('ALPHA');
        }
        const results = await this.redis.sort(...args);
        const entries = [];
        let curEntry;
        let meta;
        results.forEach((r, i) => {
            if (i % 3 === 0) {
                curEntry = [JSON.parse(r)];
            } else if (i % 3 === 1) {
                meta = JSON.parse(r);
            } else {
                meta.added = JSON.parse(r);
                curEntry.push(meta);
                entries.push(curEntry);
            }
        });
        const rval = { entries };
        if (entries.length >= 100 && entries.length + offset < count) {
            rval.next = () => this.getResults(order, entries.length);
        }
        return rval;
    }
    get(opts) {
        let order = 'added';
        if (opts && opts.order) {
            order = opts.order;
        } else if (typeof opts === 'string') {
            order = opts;
        }
        return this.getResults(order, 0);
    }
    async changeMeta(id, diff) {
        const entry = await this.redis.hmget(`logs|${id}`, 'meta', 'added');
        if (entry && entry.filter(el => !!el).length > 0) {
            const meta = JSON.parse(entry[0]);
            const added = JSON.parse(entry[1]);
            Object.assign(meta, diff);
            await this.redis.hset(`logs|${id}`, 'meta', JSON.stringify(meta));
            if (diff.reasons) {
                const args = diff.reasons.map(r => `${r}`);
                await this.redis.sadd(...[`reasons|${added}`].concat(args));
            }
            return true;
        }
        return false;
    }
    async removeReason(reason, criteria, callback) {
        const keys = await this.redis.keys('reasons|*');
        let key;
        let isMember;
        const entries = keys.map(key =>
            this.redis
                .sismember(key, reason)
                .then(isMember => (isMember ? key.substr(8) : null))
        );
        const results = await Promise.all(entries);
        const addedIds = results.filter(r => !!r).map(r => `added|${r}`);
        const logIds = await this.redis.mget(...addedIds);
        const logs = await Promise.all(
            logIds.map(logId =>
                this.redis.hmget(`logs|${logId}`, 'action', 'meta', 'added')
            )
        );
        await Promise.all(
            logs.map((log, idx) => {
                const added = JSON.parse(log[2]);
                const meta = JSON.parse(log[1]);
                if (criteria.minAdded != null && added < criteria.minAdded) {
                    return;
                }
                if (criteria.maxAdded != null && added > criteria.maxAdded) {
                    return;
                }
                if (
                    criteria.olderThan != null &&
                    !isFirstOlder(meta, criteria.olderThan)
                ) {
                    return true;
                }
                if (
                    criteria.youngerThan != null &&
                    !isFirstOlder(criteria.youngerThan, meta)
                ) {
                    return true;
                }

                if (meta.reasons.length === 1) {
                    meta.reasons = [];
                    meta.added = added;
                    callback(JSON.parse(log[0], meta));
                    return Promise.all([
                        this.redis.del(
                            `logs|${logIds[idx]}`,
                            `reasons|${added}`,
                            `added|${added}`
                        ),
                        this.redis.srem('log_ids', `${logIds[idx]}`)
                    ]);
                } else {
                    meta.reasons.splice(meta.reasons.indexOf(reason), 1);
                    return this.redis.hset(
                        `logs|${logIds[idx]}`,
                        'meta',
                        JSON.stringify(meta)
                    );
                }
            })
        );
        return null;
    }
    async getLastAdded() {
        return this.redis.get('added').then(added => added || 0);
    }
    async getLastSynced() {
        return this.redis
            .hmget('lastsynced', 'sent', 'received')
            .then(([sent, received]) => ({
                sent: sent || 0,
                received: received || 0
            }));
    }
    async setLastSynced({ sent, received }) {
		const args = {};
		if (sent != null) {
			args.sent = sent;
		}
		if (received != null) {
			args.received = received;
		}
        return this.redis
            .hmset('lastsynced', args)
            .then(([sent, received]) => ({
                sent: sent || 0,
                received: received || 0
            }));
    }
    async byId(id) {
        const entry = await this.redis.hmget(`logs|${id}`, 'action', 'meta');
        if (entry && entry[0] && entry[1]) {
            return [JSON.parse(entry[0]), JSON.parse(entry[1])];
        }
        return [null, null];
    }
    destroy() {
        return Promise.all([this.redis.flushdb()]);
    }
};

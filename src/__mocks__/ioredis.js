// Mock ioredis for testing
export default class Redis {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.get(key) || null;
  }

  async set(key, value, _mode, _duration) {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key) {
    this.data.delete(key);
    return 1;
  }

  async flushdb() {
    this.data.clear();
    return 'OK';
  }

  async quit() {
    return 'OK';
  }
}

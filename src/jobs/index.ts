import async from 'async';
import config from 'config';
const conf: any = config

const CONCURRENCY = conf.queue.concurrency;
console.log(`concurrency: ${CONCURRENCY}`);
const q = async.queue((task, callback) => {
  const obj = {
    length: q.length(),
    running: q.running(),
    task
  }
  console.log(obj);
  setTimeout(() => {
    callback()
  }, 1000);
  // callback()
}, CONCURRENCY);

export default q;

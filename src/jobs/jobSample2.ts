import async from 'async';
import config from 'config';
const conf: any = config

const CONCURRENCY = conf.jobs.jobSample1.concurrency;
export const jobSample2 = async.queue((task, callback) => {
  const obj = {
    length: jobSample2.length(),
    running: jobSample2.running(),
    task
  }
  console.log(obj);
  setTimeout(() => {
    callback()
  }, 1000);
  // callback()
}, CONCURRENCY);

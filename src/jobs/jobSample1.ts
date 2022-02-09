import async from 'async';
import config from 'config';
const conf: any = config

const CONCURRENCY = conf.jobs.jobSample1.concurrency;
const jobSample1 = async.queue((task, callback) => {
  const obj = {
    length: jobSample1.length(),
    running: jobSample1.running(),
    task
  }
  console.log(obj);
  setTimeout(() => {
    callback()
  }, 1000);
  // callback()
}, CONCURRENCY);

export default jobSample1;

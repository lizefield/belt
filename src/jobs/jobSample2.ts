import async from 'async';


// debug setting
import Debug from 'debug';
const debug = Debug('belt:server');

// load config
import config from 'config';
const conf: any = config
const CONCURRENCY = conf.jobs.jobSample2.concurrency;

//_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
// Job
//_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
const jobSample2 = async.queue((task, callback) => {
  debug(task);
  callback();
}, CONCURRENCY);

export default jobSample2;

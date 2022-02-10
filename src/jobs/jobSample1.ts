import async from 'async';


// debug setting
import Debug from 'debug';
const debug = Debug('belt:server');

// load config
import config from 'config';
const conf: any = config
const CONCURRENCY = conf.jobs.jobSample1.concurrency;

//_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
// Job
//_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
const jobSample1 = async.queue((task, callback) => {
  debug(task);
  callback();
}, CONCURRENCY);

export default jobSample1;

import config from 'config';
const conf: any = config

const JOBS = conf.jobs;
for (const job in JOBS) {
  console.log(`job: ${job}, concurrency: ${JOBS[job].concurrency}`);
}

// export jobs
export * from './jobSample1';
export * from './jobSample2';

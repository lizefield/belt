import config from 'config';
const conf: any = config

const JOBS = conf.jobs;
for (const job in JOBS) {
  console.log(`job: ${job}, concurrency: ${JOBS[job].concurrency}`);
}

// jobs
import jobSample1 from './jobSample1';
import jobSample2 from './jobSample2';

const finishCount = {
  jobSample1: 0,
  jobSample2: 0,
}

export const enqueue = (data: any) => {
  console.log(`[start job] ${JSON.stringify(data)}`);
  switch (data.jobname) {
    case 'jobSample1':
      jobSample1.push(data.params, () => {
        console.log(`[finish job] ${JSON.stringify(data)}`);
        finishCount['jobSample1']++;
      });
      break;
    case 'jobSample2':
      jobSample2.push(data.params, () => {
        console.log(`[finish job] ${JSON.stringify(data)}`);
        finishCount['jobSample2']++;
      });
      break;
    default:
      console.error(`jobname not found - ${JSON.stringify(data)}`);
  }
}

export const aggregate = () => {
  const data = {
    jobSample1: {
      concurrency: JOBS['jobSample1'].concurrency,
      length: jobSample1.length(),
      running: jobSample1.running(),
      finish: finishCount['jobSample1'],
    },
    jobSample2: {
      concurrency: JOBS['jobSample2'].concurrency,
      length: jobSample2.length(),
      running: jobSample2.running(),
      finish: finishCount['jobSample2'],
    },
  };
  return data;
}

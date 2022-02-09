import config from 'config';
const conf: any = config

const JOBS = conf.jobs;
for (const job in JOBS) {
  console.log(`job: ${job}, concurrency: ${JOBS[job].concurrency}`);
}

// jobs
import jobSample1 from './jobSample1';
import jobSample2 from './jobSample2';

export const enqueue = (data: any) => {
  console.log(`[start job] ${JSON.stringify(data)}`);
  switch (data.jobname) {
    case 'jobSample1':
      jobSample1.push(data.params, () => {
        console.log(`[finish job] ${JSON.stringify(data)}`)
      })
      break;
    case 'jobSample2':
      jobSample2.push(data.params, () => {
        console.log(`[finish job] ${JSON.stringify(data)}`)
      })
      break;
    default:
      console.error(`jobname not found - ${JSON.stringify(data)}`);
  }
}

export const aggregate = () => {
  const total = {
    jobSample1: {
      concrrent: JOBS['jobSample1'].concurrency,
      current: jobSample1.length()
    },
    jobSample2: {
      concrrent: JOBS['jobSample2'].concurrency,
      current: jobSample2.length()
    },
  }
  return total;
}

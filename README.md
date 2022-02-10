# belt

JobWorker with NodeJS.  

## API

| path | method | request | response |
| --- | --- | --- | --- |
| /healthcheck | GET | - | 'healty' |
| /aggreate | GET | - | summary data |
| /enqueue | POST | queuing data, must `jobname` and `params` | 'accepted' |

## Customize

### Create Job

under `/src/jobs`  

### Job Setting

`config/`  

### Add Job

`src/jobs/index.ts`  

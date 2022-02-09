import express from 'express';
const app: express.Express = express();

import { jobSample1, jobSample2 } from './jobs/index';

app.get('/healthcheck', (req: express.Request, res: express.Response) => {
  res.statusCode = 200;
  res.end('healthy');
});

app.get('/', (req: express.Request, res: express.Response) => {
  const text = 'jobSample1: ' + jobSample1.length() + ', jobSample2: ' + jobSample2.length();
  res.send(text);
});

app.get('/enqueue', (req: express.Request, res: express.Response) => {
  for (let i=0;i<100;i++) {
    jobSample1.push({uuid: 'd1', url: 'https://www.example.com', host: 'www.example.com'}, () => {
      console.log('finish d1')
    })
  }
  for (let i=0;i<200;i++) {
    jobSample2.push({uuid: 'd1', url: 'https://www.example.com', host: 'www.example.com'}, () => {
      console.log('finish d1')
    })
  }
  res.statusCode = 200;
  res.end('accepted');
})

export default app;

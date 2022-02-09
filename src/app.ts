import express from 'express';
const app: express.Express = express();

import { enqueue, aggregate } from './jobs/index';

app.get('/healthcheck', (req: express.Request, res: express.Response) => {
  res.statusCode = 200;
  res.end('healthy');
});

app.get('/', (req: express.Request, res: express.Response) => {
  const current = aggregate();
  const str = JSON.stringify(current);
  res.send(str);
});

app.get('/enqueue', (req: express.Request, res: express.Response) => {
  for (let i=0;i<10;i++) {
    enqueue({
      jobname: 'jobSample1',
      params: {
        uuid: 'd1', url: 'https://www.example.com', host: 'www.example.com'
      }
    });
  }
  res.statusCode = 200;
  res.end('accepted');
})

export default app;

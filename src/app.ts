import express from 'express';
const app: express.Express = express();

import q from './jobs/index';

app.get('/healthcheck', (req: express.Request, res: express.Response) => {
  res.statusCode = 200;
  res.end('healthy');
});

app.get('/', (req: express.Request, res: express.Response) => {
  const text = 'queue: ' + q.length()
  res.send(text);
});

app.get('/enqueue', (req: express.Request, res: express.Response) => {
  for (let i=0;i<10;i++) {
    q.push({uuid: 'd1', url: 'https://www.example.com', host: 'www.example.com'}, () => {
      console.log('finish d1')
    })
  }
  res.statusCode = 200;
  res.end('accepted');
})

export default app;

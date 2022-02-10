// express setting
import express from 'express';
const app: express.Express = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// debug setting
import Debug from 'debug';
const debug = Debug('belt:server');

// import job
import { enqueue, aggregate } from './jobs/index';

app.get('/healthcheck', (req: express.Request, res: express.Response) => {
  res.statusCode = 200;
  res.end('healthy');
});

app.get('/aggregate', (req: express.Request, res: express.Response) => {
  const current = aggregate();
  const str = JSON.stringify(current);
  res.send(str);
});

app.post('/enqueue', (req: express.Request, res: express.Response) => {
  debug(req.body);
  enqueue(req.body);
  res.statusCode = 200;
  res.end('accepted');
})

export default app;

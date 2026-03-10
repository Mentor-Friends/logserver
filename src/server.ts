import express from 'express';
import bodyParser from 'body-parser';
import LogRoutes from './routes/LogRoutes';
import cors from 'cors';
import { init, CCSConfig } from 'mftsccs-node';
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const ccsConfig = new CCSConfig({
  aiUrl: process.env.MFTSCCS_AI_URL || '',
  accessToken: process.env.JWT_SECRET || '',
});

init(
  process.env.MFTSCCS_BASE_URL || '',
  '',
  'LogServer',
  ccsConfig
);
app.use(express.json({ limit: '50mb' }));
// app.use(bodyParser.json());
app.use(cors());
app.use('/api', LogRoutes);
app.listen(PORT, () => {
  return console.log(`Express is listening at http://localhost:${PORT}`);
});
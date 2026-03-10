import express from 'express';
import bodyParser from 'body-parser';
import LogRoutes from './routes/LogRoutes';
import cors from 'cors';
import { init, CCSConfig } from 'mftsccs-node';
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const ccsConfig: CCSConfig = {} as CCSConfig; // fill in required properties if there are any
// base/AI URLs and JWT secret are strings; config goes last
init(
  process.env.MFTSCCS_BASE_URL || '',
  process.env.MFTSCCS_AI_URL || '',
  process.env.JWT_SECRET || '',
  ccsConfig
);
app.use(express.json({ limit: '50mb' }));
// app.use(bodyParser.json());
app.use(cors());
app.use('/api', LogRoutes);
app.listen(PORT, () => {
  return console.log(`Express is listening at http://localhost:${PORT}`);
});
import express from 'express';
import bodyParser from 'body-parser';
import LogRoutes from './routes/LogRoutes';
import cors from 'cors';
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;


app.use(bodyParser.json());
app.use(cors());
app.use('/api', LogRoutes);
app.listen(PORT, () => {
  return console.log(`Express is listening at http://localhost:${PORT}`);
});
import 'dotenv/config';
import express from 'express';
import LogRoutes from './routes/LogRoutes';
import cors from 'cors';
import { init } from 'mftsccs-node';

const app = express();
const PORT = process.env.PORT || 3000;
init(process.env.MFTSCCS_BASE_URL, process.env.MFTSCCS_AI_URL)
app.use(express.json({ limit: '50mb' }));
// app.use(bodyParser.json());
app.use(cors({
  origin : '*',
  methods: ["GET","POST", "PUT", "DELETE"],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/api', LogRoutes);
app.listen(PORT, () => {
  return console.log(`Express is listening at http://localhost:${PORT}`);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./services/database');
const recoveryRoutes = require('./routes/recovery');
const disputeRoutes = require('./routes/dispute');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

initDb();

app.use('/api/recovery', recoveryRoutes);
app.use('/api/dispute', disputeRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: "Hello, world!" });
});

router.get('/time', (req, res) => {
  res.json({ currentTime: new Date().toISOString() });
});

router.post('/echo', (req, res) => {
  res.json({
    receivedData: req.body
  });
});

module.exports = router;
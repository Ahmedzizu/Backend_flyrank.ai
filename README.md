BE-01: Build Your First API Endpoint
A minimal Express server exposing two JSON endpoints.

Endpoints
GET / -> { "message": "Hello, world!" }

GET /time -> { "currentTime": "<ISO timestamp>" }

Run locally
text
npm install
npm start
Test
text
curl http://localhost:3000/
curl http://localhost:3000/time
Or open http://localhost:3000/ and http://localhost:3000/time in your browser.

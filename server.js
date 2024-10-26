const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const uiRoutes = require('./uiRoutes');
const setupCronJobs = require('./cronJobs');

const app = express();
const PORT = 8886;

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Open SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Database connected');
    createTables();
    setupCronJobs(db);  // Set up cron jobs after database connection
  }
});

// Create tables if they don't exist
function createTables() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Suno (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_date TEXT,
      modified_date TEXT,
      cookies TEXT,
      email TEXT,
      status TEXT CHECK(status IN ('VALID', 'INVALID'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Vercel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_date TEXT,
      modified_date TEXT,
      api_endpoint_url TEXT,
      suno_id INTEGER UNIQUE,
      description TEXT,
      requestLimit INTEGER DEFAULT 2,
      FOREIGN KEY (suno_id) REFERENCES Suno(id)
    )`);
  });
}

// Function to get API instances from the database
function getApiInstances(vercelId = null) {
  return new Promise((resolve, reject) => {
    let query = `SELECT v.id, v.api_endpoint_url, v.requestLimit, s.status 
                 FROM Vercel v 
                 JOIN Suno s ON v.suno_id = s.id 
                 WHERE s.status = 'VALID'`;
    let params = [];

    if (vercelId) {
      query += ' AND v.id = ?';
      params.push(vercelId);
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Error fetching API instances', err);
        resolve([]);
      } else {
        const apiInstances = rows.map(row => ({
          id: row.id,
          url: row.api_endpoint_url,
          requestLimit: row.requestLimit
        }));
        resolve(apiInstances);
      }
    });
  });
}

// Track request count and last access time for each instance
const requestTracker = [];

// Function to get the next available instance
async function getAvailableInstance(vercelId = null) {
  const apiInstances = await getApiInstances(vercelId);
  const currentTime = Date.now();

  // Ensure requestTracker is initialized for all instances
  while (requestTracker.length < apiInstances.length) {
    requestTracker.push({ requestCount: 0, lastAccess: 0 });
  }

  for (let i = 0; i < apiInstances.length; i++) {
    if (requestTracker[i].requestCount < apiInstances[i].requestLimit ||
      currentTime - requestTracker[i].lastAccess > 30000) {

      if (currentTime - requestTracker[i].lastAccess > 30000) {
        requestTracker[i].requestCount = 0; // Reset count after cooldown
      }

      return { id: apiInstances[i].id, url: apiInstances[i].url, index: i, requestLimit: apiInstances[i].requestLimit };
    }
  }
  return null; // No available instance within limit
}

// Proxy request with failover
async function proxyRequest(req, res) {
  let attempts = 0;
  const maxAttempts = 3;

  const tryRequest = async () => {
    if (attempts >= maxAttempts) {
      return res.status(503).send('All API instances are currently busy. Please try again later.');
    }

    // get from request body or params  
    const vercelId = req.body.apiEndpointId || req.query.apiEndpointId;
    const instance = await getAvailableInstance(vercelId);
    if (!instance) {
      console.log('No available instance');
      attempts++;
      console.log(`No available instance. Attempt ${attempts} of ${maxAttempts}.`);
      return setTimeout(tryRequest, 400); // Wait 1 second before retrying
    }

    try {
      const response = await axios({
        method: req.method,
        url: `${instance.url}${req.path}`,
        headers: {
          ...req.headers,
          host: new URL(instance.url).host,
          'Accept-Encoding': 'identity'
        },
        data: req.body,
        validateStatus: false,
        decompress: false
      });

      // Check for 402 status code and "Insufficient credits" error
      if (response.status === 402 && response.data && response.data.error === "Insufficient credits.") {
        console.log(`Instance ${instance.url} has insufficient credits. Updating status to INVALID.`);
        await updateVercelStatus(instance.url, 'INVALID');
        attempts++;
        return setTimeout(tryRequest, 400); // Retry with another instance
      }

      // Forward the response status, headers, and data
      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== 'content-encoding') {
          res.setHeader(key, value);
        }
      });
      if (instance && req.path.startsWith('/api/') && response.data && typeof response.data === 'object') {
        response.data.apiEndpointId = instance.id;
      }
      res.removeHeader('Content-Encoding');
      res.send(response.data);
      // Increase the requestCount only when the forward request is successful
      if (req.method === 'POST') {
        requestTracker[instance.index].requestCount++;
        requestTracker[instance.index].lastAccess = Date.now();
      }
    } catch (error) {
      console.error(`Error with instance ${instance.url}:`, error.message);
      attempts++;
      console.log(`Trying another instance. Attempt ${attempts} of ${maxAttempts}.`);
      setTimeout(tryRequest, 400);
    }
  };

  tryRequest();
}

// Function to update Vercel status
function updateVercelStatus(apiEndpointUrl, status) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE Suno SET status = ? WHERE id = (SELECT suno_id FROM Vercel WHERE api_endpoint_url = ?)`,
      [status, apiEndpointUrl],
      (err) => {
        if (err) {
          console.error('Error updating Vercel status:', err);
          reject(err);
        } else {
          console.log(`Updated status for ${apiEndpointUrl} to ${status}`);
          resolve();
        }
      }
    );
  });
}

// Add a catch-all route to handle all methods and paths
app.all('*', (req, res) => {
  if (req.path.startsWith('/ui')) {
    // Let the UI routes handle this
    uiRouter(req, res);
    return;
  }
  proxyRequest(req, res);
});

// Close the database connection when the server is shutting down
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});

const uiRouter = uiRoutes(db);
app.use('/ui', uiRouter);
// Add this near the end of the file, after other route definitions but before app.listen()
app.use((req, res, next) => {
  console.log('Received request:', req.method, req.url);
  next();
});

// Keep your error handler here
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

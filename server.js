const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

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
      FOREIGN KEY (suno_id) REFERENCES Suno(id)
    )`);
  });
}

// Function to get API instances from the database
function getApiInstances(callback) {
  db.all(`SELECT v.api_endpoint_url, s.status 
          FROM Vercel v 
          JOIN Suno s ON v.suno_id = s.id 
          WHERE s.status = 'VALID'`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching API instances', err);
      callback([]);
    } else {
      const apiInstances = rows.map(row => row.api_endpoint_url);
      callback(apiInstances);
    }
  });
}

// Track request count and last access time for each instance
const requestTracker = [];

// Function to get the next available instance
function getAvailableInstance(callback) {
  getApiInstances((apiInstances) => {
    const currentTime = Date.now();
    
    // Ensure requestTracker is initialized for all instances
    while (requestTracker.length < apiInstances.length) {
      requestTracker.push({ requestCount: 0, lastAccess: 0 });
    }
    
    for (let i = 0; i < apiInstances.length; i++) {
      if (requestTracker[i].requestCount < 2 ||
          currentTime - requestTracker[i].lastAccess > 30000) {
        
        if (currentTime - requestTracker[i].lastAccess > 30000) {
          requestTracker[i].requestCount = 0; // Reset count after cooldown
        }

        requestTracker[i].requestCount++;
        requestTracker[i].lastAccess = currentTime;
        callback(apiInstances[i]);
        return;
      }
    }
    callback(null); // No available instance within limit
  });
}

// Proxy request with failover
async function proxyRequest(req, res) {
  let attempts = 0;
  let response = null;

  const tryRequest = async () => {
    if (attempts >= 3) { // Assuming max 3 attempts
      return res.status(503).send('All API instances are currently busy. Please try again later.');
    }

    getAvailableInstance(async (instanceUrl) => {
      if (!instanceUrl) {
        return res.status(503).send('All API instances are currently busy. Please try again later.');
      }

      try {
        response = await axios({
          method: req.method,
          url: `${instanceUrl}${req.path}`,
          headers: req.headers,
          data: req.body
        });
        res.status(response.status).send(response.data);
      } catch (error) {
        if (error.response && error.response.status === 500) {
          attempts++;
          console.log(`Instance ${instanceUrl} failed. Trying another instance.`);
          tryRequest(); // Retry with another instance
        } else {
          res.status(error.response?.status || 500).send(error.message);
        }
      }
    });
  };

  tryRequest();
}

// Middleware to parse JSON
app.use(express.json());

// UI Routes
app.get('/ui', (req, res) => {
  db.all('SELECT v.*, s.email, s.status FROM Vercel v JOIN Suno s ON v.suno_id = s.id', [], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).send('Error fetching data');
    } else {
      res.render('index', { pairs: rows });
    }
  });
});

app.get('/ui/add', (req, res) => {
  res.render('add');
});

app.post('/ui/add', (req, res) => {
  const sunoData = {
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    cookies: req.body.cookies,
    email: req.body.email,
    status: req.body.status
  };

  const vercelData = {
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    api_endpoint_url: req.body.api_endpoint_url,
    description: req.body.description
  };

  addSunoVercelPair(sunoData, vercelData, (err) => {
    if (err) {
      console.error('Error adding Suno-Vercel pair', err);
      res.status(500).send('Error adding data');
    } else {
      res.redirect('/ui');
    }
  });
});

app.get('/ui/edit/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT v.*, s.* FROM Vercel v JOIN Suno s ON v.suno_id = s.id WHERE v.id = ?', [id], (err, row) => {
    if (err) {
      console.error(err);
      res.status(500).send('Error fetching data');
    } else if (!row) {
      res.status(404).send('Not found');
    } else {
      res.render('edit', { pair: row });
    }
  });
});

app.post('/ui/edit/:id', (req, res) => {
  const id = req.params.id;
  const sunoData = [
    req.body.cookies,
    req.body.email,
    req.body.status,
    new Date().toISOString(),
    id
  ];
  const vercelData = [
    req.body.api_endpoint_url,
    req.body.description,
    new Date().toISOString(),
    id
  ];

  db.run('BEGIN TRANSACTION');
  db.run('UPDATE Suno SET cookies = ?, email = ?, status = ?, modified_date = ? WHERE id = (SELECT suno_id FROM Vercel WHERE id = ?)', sunoData, (err) => {
    if (err) {
      console.error(err);
      db.run('ROLLBACK');
      res.status(500).send('Error updating data');
    } else {
      db.run('UPDATE Vercel SET api_endpoint_url = ?, description = ?, modified_date = ? WHERE id = ?', vercelData, (err) => {
        if (err) {
          console.error(err);
          db.run('ROLLBACK');
          res.status(500).send('Error updating data');
        } else {
          db.run('COMMIT');
          res.redirect('/ui');
        }
      });
    }
  });
});

app.get('/ui/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run('BEGIN TRANSACTION');
  db.run('DELETE FROM Vercel WHERE id = ?', [id], (err) => {
    if (err) {
      console.error(err);
      db.run('ROLLBACK');
      res.status(500).send('Error deleting data');
    } else {
      db.run('DELETE FROM Suno WHERE id = (SELECT suno_id FROM Vercel WHERE id = ?)', [id], (err) => {
        if (err) {
          console.error(err);
          db.run('ROLLBACK');
          res.status(500).send('Error deleting data');
        } else {
          db.run('COMMIT');
          res.redirect('/ui');
        }
      });
    }
  });
});

// API proxy route
app.use('/api', proxyRequest);

// Catch-all route for the main page
app.get('/', (req, res) => {
  res.redirect('/ui');
});

// Function to add a new Suno and Vercel pair
function addSunoVercelPair(sunoData, vercelData, callback) {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(`INSERT INTO Suno (created_date, modified_date, cookies, email, status) 
            VALUES (?, ?, ?, ?, ?)`,
      [sunoData.created_date, sunoData.modified_date, sunoData.cookies, sunoData.email, sunoData.status],
      function(err) {
        if (err) {
          console.error('Error inserting Suno data', err);
          db.run('ROLLBACK');
          callback(err);
          return;
        }

        const sunoId = this.lastID;

        db.run(`INSERT INTO Vercel (created_date, modified_date, api_endpoint_url, suno_id, description) 
                VALUES (?, ?, ?, ?, ?)`,
          [vercelData.created_date, vercelData.modified_date, vercelData.api_endpoint_url, sunoId, vercelData.description],
          (err) => {
            if (err) {
              console.error('Error inserting Vercel data', err);
              db.run('ROLLBACK');
              callback(err);
            } else {
              db.run('COMMIT');
              callback(null);
            }
          }
        );
      }
    );
  });
}

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

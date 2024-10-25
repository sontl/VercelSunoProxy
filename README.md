# API Load Balancer and Proxy Server

This project is a Node.js-based API load balancer and proxy server that manages multiple API instances, distributes requests, and provides a simple UI for managing API endpoints.

## Features

- Load balancing across multiple API instances
- Request rate limiting and cooldown periods
- Failover mechanism for handling busy or failed instances
- SQLite database for storing API instance information
- Web UI for managing API endpoints (accessible via `/ui` routes)
- Proxy all incoming requests to available API instances

## Prerequisites

- Node.js (v12 or higher recommended)
- npm (Node Package Manager)

## Installation

1. Clone this repository:
   ```
   git clone <repository-url>
   cd <project-directory>
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up the SQLite database:
   The server will automatically create a `database.sqlite` file and necessary tables on first run.

## Usage

1. Start the server:
   ```
   node server.js
   ```

2. The server will start running on `http://localhost:8886`

3. To access the UI for managing API endpoints, navigate to:
   ```
   http://localhost:8886/ui
   ```

4. To use the load balancer, send your API requests to:
   ```
   http://localhost:8886/<your-api-endpoint>
   ```
   The server will proxy your request to an available API instance.

## Configuration

- The server runs on port 8886 by default. You can change this in the `server.js` file.
- API instances are stored in the SQLite database and can be managed through the UI.

## How it works

1. The server maintains a list of valid API instances in the SQLite database.
2. When a request comes in, the server selects an available instance based on recent usage.
3. The request is proxied to the selected instance.
4. If an instance is busy or fails, the server will try other instances.
5. A simple rate limiting mechanism prevents overloading any single instance.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Add your chosen license here]

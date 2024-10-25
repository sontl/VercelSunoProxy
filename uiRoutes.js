const express = require('express');
const router = express.Router();

module.exports = function (db) {
    console.log('uiRoutes initialized with db:', !!db);

    router.use((req, res, next) => {
        console.log('UI route accessed:', req.method, req.url);
        next();
    });

    router.get('/ui', (req, res) => {
        console.log('Accessing root UI route');
        db.all('SELECT v.*, s.email, s.status FROM Vercel v JOIN Suno s ON v.suno_id = s.id', [], (err, rows) => {
            if (err) {
                console.error('Error in root route:', err);
                res.status(500).send('Error fetching data');
            } else {
                console.log('Fetched rows:', rows.length);
                res.render('index', { pairs: rows });
            }
        });
    });

    router.get('/ui/add', (req, res) => {
        console.log('Accessing /add route');
        res.render('add');
    });

    router.post('/ui/add', (req, res) => {
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

        addSunoVercelPair(db, sunoData, vercelData, (err) => {
            if (err) {
                console.error('Error adding Suno-Vercel pair', err);
                res.status(500).send('Error adding data');
            } else {
                res.redirect('/ui');
            }
        });
    });

    router.get('/ui/edit/:id', (req, res) => {
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

    router.post('/ui/edit/:id', (req, res) => {
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

    router.get('/ui/delete/:id', (req, res) => {
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

    // Add this catch-all route at the end
    router.use((req, res, next) => {
        console.log('Unhandled route:', req.method, req.url);
        res.status(404).send('Not found');
    });

    return router;
};

function addSunoVercelPair(db, sunoData, vercelData, callback) {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(`INSERT INTO Suno (created_date, modified_date, cookies, email, status) 
            VALUES (?, ?, ?, ?, ?)`,
            [sunoData.created_date, sunoData.modified_date, sunoData.cookies, sunoData.email, sunoData.status],
            function (err) {
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

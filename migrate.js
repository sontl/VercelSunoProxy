const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // Check if the RequestLimit column exists
    db.all("PRAGMA table_info(Vercel)", (err, rows) => {
        if (err) {
            console.error('Error checking table info:', err);
            db.close();
            return;
        }

        const requestLimitExists = rows.some(row => row.name === 'RequestLimit');

        if (!requestLimitExists) {
            // Add the RequestLimit column
            db.run("ALTER TABLE Vercel ADD COLUMN RequestLimit INTEGER DEFAULT 2", (err) => {
                if (err) {
                    console.error('Error adding RequestLimit column:', err);
                } else {
                    console.log('RequestLimit column added successfully');
                }
                db.close();
            });
        } else {
            console.log('RequestLimit column already exists');
            db.close();
        }
    });
});

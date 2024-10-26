const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // Check if the RequestLimit or requestLimit column exists
    db.all("PRAGMA table_info(Vercel)", (err, rows) => {
        if (err) {
            console.error('Error checking table info:', err);
            db.close();
            return;
        }

        const requestLimitExists = rows.some(row => row.name === 'requestLimit');
        const RequestLimitExists = rows.some(row => row.name === 'RequestLimit');

        if (RequestLimitExists) {
            // Rename RequestLimit to requestLimit
            db.run("ALTER TABLE Vercel RENAME COLUMN RequestLimit TO requestLimit", (err) => {
                if (err) {
                    console.error('Error renaming RequestLimit column:', err);
                } else {
                    console.log('RequestLimit column renamed to requestLimit successfully');
                }
                db.close();
            });
        } else if (!requestLimitExists) {
            // Add the requestLimit column if it doesn't exist
            db.run("ALTER TABLE Vercel ADD COLUMN requestLimit INTEGER DEFAULT 2", (err) => {
                if (err) {
                    console.error('Error adding requestLimit column:', err);
                } else {
                    console.log('requestLimit column added successfully');
                }
                db.close();
            });
        } else {
            console.log('requestLimit column already exists');
            db.close();
        }
    });
});

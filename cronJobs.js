const cron = require('node-cron');

function setupCronJobs(db) {
    // Function to reset all Suno statuses to VALID
    function resetSunoStatuses() {
        return new Promise((resolve, reject) => {
            db.run(`UPDATE Suno SET status = 'VALID'`, (err) => {
                if (err) {
                    console.error('Error resetting Suno statuses:', err);
                    reject(err);
                } else {
                    console.log('All Suno statuses reset to VALID');
                    resolve();
                }
            });
        });
    }

    // Schedule the batch job to run at 0 UTC every day
    cron.schedule('0 0 * * *', async () => {
        console.log('Running daily batch job to reset Suno statuses');
        try {
            await resetSunoStatuses();
        } catch (error) {
            console.error('Error in daily batch job:', error);
        }
    });
}

module.exports = setupCronJobs;

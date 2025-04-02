const express = require('express');
const path = require('path');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// Ensure that the uploads and public/gifs directories exist
const ensureDirExistence = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};
ensureDirExistence(path.join(__dirname, 'uploads'));
ensureDirExistence(path.join(__dirname, 'public', 'gifs'));

// Serve static files from the public folder securely
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads – storing uploaded files in the 'uploads' folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Generate a unique ID using uuidv4 and retain the original file extension
        const fileExtension = path.extname(file.originalname).toLowerCase();
        const uniqueFilename = uuidv4() + fileExtension; // Unique file name based on UUID
        cb(null, uniqueFilename);
    }
});

// Define file size limit and allowed file types (MP4, MOV, etc.)
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // Max file size of 100MB
    },
    fileFilter: (req, file, cb) => {
        const filetypes = /mp4|mov/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            return cb(new Error('Only MP4 and MOV files are allowed.'));
        }
    }
});

// Middleware for general error handling
app.use((err, req, res, next) => {
    console.error(err); // Log detailed error for internal debugging
    if (err instanceof multer.MulterError) {
        // Multer-specific errors
        return res.status(400).send('An error occurred during file upload.');
    }
    // General errors
    res.status(500).send('An unexpected error occurred.');
});

/**
 * Convert MP4 to high-quality GIF using a two-step process:
 * 1. Generate a color palette from the video.
 * 2. Use the generated palette to produce the final GIF.
 */
function convertMp4ToGif(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const palettePath = `${inputPath}-palette.png`;

        // Step 1: Generate the palette
        ffmpeg(inputPath)
            .outputOptions([
                '-vf', 'fps=15,scale=1080:-1:flags=lanczos,palettegen'
            ])
            .output(palettePath)
            .on('start', commandLine => {
                console.log('Generating palette with command:', commandLine);
            })
            .on('error', (err, stdout, stderr) => {
                console.error('Error generating palette:', err.message);
                console.log('stdout:', stdout);
                console.log('stderr:', stderr);
                reject(new Error('Palette generation failed: ' + err.message));
            })
            .on('end', () => {
                console.log('Palette generated successfully.');

                // Step 2: Use the palette to create a high-quality GIF
                ffmpeg(inputPath)
                    .input(palettePath)
                    .complexFilter([
                        'fps=15,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse'
                    ])
                    .output(outputPath)
                    .on('start', commandLine => {
                        console.log('Converting to GIF with command:', commandLine);
                    })
                    .on('error', (err, stdout, stderr) => {
                        console.error('Error during GIF conversion:', err.message);
                        console.log('stdout:', stdout);
                        console.log('stderr:', stderr);
                        fs.unlink(palettePath, unlinkErr => {
                            if (unlinkErr) console.error('Error deleting palette:', unlinkErr);
                        });
                        reject(new Error('GIF conversion failed: ' + err.message));
                    })
                    .on('end', () => {
                        console.log('GIF conversion finished successfully.');
                        fs.unlink(palettePath, err => {
                            if (err) console.error('Error deleting palette file:', err);
                        });
                        resolve('Conversion complete');
                    })
                    .run();
            })
            .run();
    });
}

// POST endpoint to upload the video and convert it
app.post('/convert', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const inputFilePath = req.file.path;
    const outputFileName = uuidv4() + '.gif'; // Unique file name for the GIF output
    const outputFilePath = path.join('public', 'gifs', outputFileName);

    try {
        await convertMp4ToGif(inputFilePath, outputFilePath);

        // Send the generated GIF URL to the client
        res.json({ gifUrl: `/gifs/${outputFileName}` });

        // Delete the input file immediately after conversion
        fs.unlink(inputFilePath, (err) => {
            if (err) {
                console.error('Error deleting uploaded video:', err);
            }
        });

        // Schedule deletion of the converted GIF after it has been served
        setTimeout(() => {
            fs.unlink(outputFilePath, (err) => {
                if (err) {
                    console.error('Error deleting converted GIF:', err);
                }
            });
        }, 60000); // Deletes the GIF file after 60 seconds (adjust timing as necessary)

    } catch (error) {
        console.error('Conversion error:', error); // Log detailed error internally
        res.status(500).send('An error occurred during conversion.');
    }
});

// Start the Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

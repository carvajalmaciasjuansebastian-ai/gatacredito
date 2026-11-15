const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'loans_db.json');

app.use(cors());
app.use(express.json());

// Leer préstamos guardados
function readLoansData() {
    if (!fs.existsSync(DATA_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Guardar préstamos
function writeLoansData(loans) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(loans, null, 2));
}

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Backend de GataCredito funcionando correctamente 🚀');
});

// Obtener todos los préstamos
app.get('/api/loans', (req, res) => {
    const loans = readLoansData();
    res.json(loans);
});

// Guardar o sincronizar todos los préstamos
app.post('/api/loans', (req, res) => {
    const loans = req.body;
    if (Array.isArray(loans)) {
        writeLoansData(loans);
        res.json({ success: true, message: 'Datos guardados correctamente en la nube' });
    } else {
        res.status(400).json({ success: false, message: 'Formato de datos inválido' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
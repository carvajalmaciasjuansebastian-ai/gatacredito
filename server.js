const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de PostgreSQL en Render usando la variable de entorno
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Configuración de Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Función para enviar mensajes al grupo de Telegram
async function sendTelegramAlert(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('Telegram no configurado. Alerta omitida.');
        return;
    }
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (err) {
        console.error('Error enviando alerta a Telegram:', err);
    }
}

// Inicializar tabla en la base de datos PostgreSQL si no existe
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS loans (
                id VARCHAR(50) PRIMARY KEY,
                data JSONB NOT NULL
            );
        `);
        console.log('Base de datos PostgreSQL conectada y tabla lista.');
    } catch (err) {
        console.error('Error inicializando la base de datos:', err);
    }
}
initDB();

// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Backend de GataCredito con PostgreSQL y Telegram activo 🚀');
});

// Obtener todos los préstamos desde PostgreSQL
app.get('/api/loans', async (req, res) => {
    try {
        const result = await pool.query('SELECT data FROM loans');
        const loans = result.rows.map(row => row.data);
        res.json(loans);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener los préstamos' });
    }
});

// Guardar o sincronizar préstamos en PostgreSQL y alertar si hay nuevos
app.post('/api/loans', async (req, res) => {
    const loans = req.body;
    if (!Array.isArray(loans)) {
        return res.status(400).json({ success: false, message: 'Formato de datos inválido' });
    }

    try {
        // Consultar los IDs que ya estaban guardados para detectar cuáles son nuevos
        const currentResult = await pool.query('SELECT id FROM loans');
        const existingIds = new Set(currentResult.rows.map(r => r.id));

        for (const loan of loans) {
            if (!existingIds.has(loan.id)) {
                // Es un préstamo NUEVO, enviamos alerta al grupo de Telegram
                const interest = loan.totalPayable - loan.amount;
                const alertMsg = 
`🚨 *¡NUEVO PRÉSTAMO REGISTRADO!* 🐾
━━━━━━━━━━━━━━━━━━
👤 *Cliente:* ${loan.clientName}
📱 *Teléfono:* ${loan.clientPhone || 'No registrado'}
💰 *Monto:* $${Number(loan.amount).toLocaleString('es-CO')}
📈 *Interés:* ${loan.interestRate}% ($${Number(interest).toLocaleString('es-CO')})
💵 *Total a Cobrar:* $${Number(loan.totalPayable).toLocaleString('es-CO')}
📅 *Frecuencia:* ${loan.frequency} (${loan.installmentsCount} cuotas)
📌 *Valor Cuota:* $${Number(loan.installmentValue).toLocaleString('es-CO')}
━━━━━━━━━━━━━━━━━━
_Registrado en GataCredito_`;

                await sendTelegramAlert(alertMsg);
            }

            // Insertar o actualizar en la base de datos
            await pool.query(
                `INSERT INTO loans (id, data) VALUES ($1, $2) 
                 ON CONFLICT (id) DO UPDATE SET data = $2`,
                [loan.id, JSON.stringify(loan)]
            );
        }

        res.json({ success: true, message: 'Sincronizado con PostgreSQL correctamente' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al guardar en la base de datos' });
    }
});

// TAREA AUTOMÁTICA DIARIA: Alerta de cobros a las 8:00 AM (Hora Colombia)
cron.schedule('0 8 * * *', async () => {
    try {
        const result = await pool.query('SELECT data FROM loans');
        const loans = result.rows.map(r => r.data);
        
        const todayStr = new Date().toISOString().split('T')[0];
        let cobrosHoy = [];
        let atrasados = [];

        loans.forEach(loan => {
            const paid = loan.payments.reduce((sum, p) => sum + p.amount, 0);
            if (paid >= loan.totalPayable - 0.01) return; // Préstamo ya cancelado

            const nextDueDate = calculateNextDueDateForCron(loan);
            if (nextDueDate === todayStr) {
                cobrosHoy.push(loan);
            } else if (nextDueDate < todayStr) {
                atrasados.push(loan);
            }
        });

        if (cobrosHoy.length > 0 || atrasados.length > 0) {
            let msg = `🔔 *AGENDA DE COBROS - GATACREDITO* 🐾\n📅 *Fecha:* ${todayStr}\n━━━━━━━━━━━━━━━━━━\n`;
            
            if (cobrosHoy.length > 0) {
                msg += `\n🎯 *COBROS PARA HOY (${cobrosHoy.length}):*\n`;
                cobrosHoy.forEach(l => {
                    msg += `• *${l.clientName}* — Cuota: $${Number(l.installmentValue).toLocaleString('es-CO')} (📞 ${l.clientPhone || 'S/N'})\n`;
                });
            }

            if (atrasados.length > 0) {
                msg += `\n⚠️ *CLIENTES ATRASADOS (${atrasados.length}):*\n`;
                atrasados.forEach(l => {
                    msg += `• *${l.clientName}* — Cuota vencida (📞 ${l.clientPhone || 'S/N'})\n`;
                });
            }

            msg += `\n_¡Revisa tu libreta digital para cobrar a tiempo!_`;
            await sendTelegramAlert(msg);
        }
    } catch (err) {
        console.error('Error en la tarea automática de cobros:', err);
    }
}, {
    timezone: "America/Bogota"
});

function calculateNextDueDateForCron(loan) {
    const paidCount = loan.payments.length;
    const start = new Date(loan.startDate + 'T00:00:00');
    let daysToAdd = 0;
    const mult = paidCount + 1;

    switch(loan.frequency) {
        case 'diario': daysToAdd = 1 * mult; break;
        case 'semanal': daysToAdd = 7 * mult; break;
        case 'quincenal': daysToAdd = 15 * mult; break;
        case 'mensual': daysToAdd = 30 * mult; break;
    }

    start.setDate(start.getDate() + daysToAdd);
    return start.toISOString().split('T')[0];
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.set('io', io);

const db = new sqlite3.Database('./reservas.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS reservas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT,
        curso TEXT,
        fecha TEXT,
        recurso TEXT,
        hora TEXT,
        cantidad INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS inventario (
        recurso TEXT PRIMARY KEY,
        cantidad INTEGER
    )`);
    const recursos = [
        { recurso: 'Tablet', cantidad: 96 },
        { recurso: 'Cargadores', cantidad: 96 },
        { recurso: 'Datas', cantidad: 2 },
        { recurso: 'HDMI', cantidad: 2 }
    ];
    recursos.forEach(r => {
        db.run(`INSERT OR IGNORE INTO inventario (recurso, cantidad) VALUES (?, ?)`, [r.recurso, r.cantidad]);
    });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Obtener todas las reservas
app.get('/api/reservas', (req, res) => {
    db.all('SELECT * FROM reservas', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener reservas' });
        }
        res.json(rows);
    });
});

// Obtener inventario
app.get('/api/inventario', (req, res) => {
    db.all('SELECT * FROM inventario', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener inventario' });
        }
        res.json(rows);
    });
});

// Crear una reserva
app.post('/api/reservar', (req, res) => {
    const { nombre, curso, fecha, recurso, hora, cantidad } = req.body;
    const recursosConInventario = ['Tablet', 'Cargadores', 'Datas', 'HDMI'];

    if (recurso === 'Sala de informática') {
        db.get('SELECT * FROM reservas WHERE recurso = ? AND fecha = ? AND hora = ?', 
            [recurso, fecha, hora], 
            (err, row) => {
                if (err) return res.json({ mensaje: 'Error al verificar la reserva.' });
                if (row) return res.json({ mensaje: 'No puedes reservar a esta hora, otra persona ya lo hizo' });
                guardarReserva();
            }
        );
    } else if (recursosConInventario.includes(recurso)) {
        db.get('SELECT cantidad FROM inventario WHERE recurso = ?', [recurso], (err, row) => {
            if (err) return res.json({ mensaje: 'Error al verificar inventario.' });
            const disponible = row ? row.cantidad : 0;
            if (cantidad > disponible) {
                return res.json({ mensaje: `Solo queda esta ${disponible} cantidad de lo que está pidiendo` });
            }
            db.run('UPDATE inventario SET cantidad = cantidad - ? WHERE recurso = ?', [cantidad, recurso], (err) => {
                if (err) return res.json({ mensaje: 'Error al actualizar inventario.' });
                guardarReserva();
            });
        });
    } else {
        guardarReserva();
    }

    function guardarReserva() {
        db.run('INSERT INTO reservas (nombre, curso, fecha, recurso, hora, cantidad) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, curso, fecha, recurso, hora, cantidad],
            function(err) {
                if (err) return res.json({ mensaje: 'Error al guardar la reserva.' });
                app.get('io')?.emit('nuevaReserva', { nombre, curso, fecha, recurso, hora, cantidad });
                res.json({ mensaje: '¡Reserva realizada con éxito!' });
            }
        );
    }
});

app.delete('/api/reservas/:id', (req, res) => {
    const id = req.params.id;
    // Primero obtenemos la reserva eliminada
    db.get('SELECT recurso, cantidad FROM reservas WHERE id = ?', [id], (err, reserva) => {
        if (err || !reserva) {
            return res.status(500).json({ error: 'Error al obtener la reserva' });
        }
        // Eliminamos la reserva
        db.run('DELETE FROM reservas WHERE id = ?', [id], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al eliminar la reserva' });
            }
            // Si el recurso es de inventario, lo sumamos de nuevo
            const recursosConInventario = ['Tablet', 'Cargadores', 'Datas', 'HDMI'];
            if (recursosConInventario.includes(reserva.recurso)) {
                db.run('UPDATE inventario SET cantidad = cantidad + ? WHERE recurso = ?', [reserva.cantidad, reserva.recurso], (err) => {
                    // No es necesario manejar el error aquí, solo actualizamos
                    res.json({ mensaje: 'Reserva eliminada y inventario actualizado' });
                });
            } else {
                res.json({ mensaje: 'Reserva eliminada' });
            }
        });
    });
});

http.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
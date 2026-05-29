"""
PAC-BEAR Flask Backend
======================
Serves the static game files and exposes a REST API for score persistence.

Run:
    python app.py

Environment variables:
    FLASK_DEBUG=1   — enable Flask debug mode (default: off)
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_from_directory

# ── Configuration ────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, 'scores.db')
DEBUG_MODE = os.environ.get('FLASK_DEBUG', '0') == '1'

app = Flask(__name__, static_folder=None)

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
log = logging.getLogger(__name__)

# ── Database helpers ─────────────────────────────────────────

REQUIRED_COLUMNS = {'id', 'player_name', 'score', 'timestamp'}


def get_db_connection() -> sqlite3.Connection:
    """Open scores.db with row_factory set to sqlite3.Row."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def validate_schema(conn: sqlite3.Connection) -> bool:
    """Return True if the scores table has all required columns."""
    cursor = conn.execute("PRAGMA table_info(scores)")
    columns = {row['name'] for row in cursor.fetchall()}
    return REQUIRED_COLUMNS.issubset(columns)


def init_db() -> None:
    """
    Create scores.db and the scores table if they don't exist.
    If the table exists but is missing required columns, log an error and exit.
    """
    conn = get_db_connection()
    try:
        # Check whether the table already exists
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scores'"
        )
        table_exists = cursor.fetchone() is not None

        if table_exists:
            if not validate_schema(conn):
                log.error(
                    "scores table exists but is missing required columns "
                    "(%s). Fix or delete scores.db and restart.",
                    REQUIRED_COLUMNS,
                )
                conn.close()
                sys.exit(1)
            log.info("Existing scores.db schema is valid.")
        else:
            conn.execute("""
                CREATE TABLE scores (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_name TEXT    NOT NULL,
                    score       INTEGER NOT NULL,
                    timestamp   TEXT    NOT NULL
                )
            """)
            conn.commit()
            log.info("Created scores.db with scores table.")
    finally:
        conn.close()


# ── Static file routes ───────────────────────────────────────

@app.route('/')
def serve_index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/game.js')
def serve_game_js():
    return send_from_directory(BASE_DIR, 'game.js')


@app.route('/BearIcon.png')
def serve_logo():
    #return send_from_directory(BASE_DIR, 'kiro-logo.png')
    response = send_from_directory(BASE_DIR, 'BearIcon.png')
    response.headers['Cache-Control'] = 'no-store'
    return response


# ── Score API ────────────────────────────────────────────────

@app.route('/api/scores', methods=['POST'])
def submit_score():
    """
    POST /api/scores
    Body: { "player_name": str, "score": int }
    Returns 201 with the saved entry, or 400/503 on error.
    """
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'error': 'request body must be valid JSON'}), 400

    # Validate player_name
    player_name = data.get('player_name')
    if player_name is None or not isinstance(player_name, str) or not player_name.strip():
        return jsonify({'error': 'player_name must not be empty'}), 400
    player_name = player_name.strip()
    
    if len(player_name) > 50:
        player_name = player_name[:50]


    # Validate score
    score = data.get('score')
    if score is None or not isinstance(score, int) or isinstance(score, bool):
        return jsonify({'error': 'score must be an integer'}), 400
    if score < 0 or score > 1_000_000:
        return jsonify({'error': 'score must be between 0 and 1000000'}), 400

    # Persist
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    try:
        conn = get_db_connection()
        cursor = conn.execute(
            'INSERT INTO scores (player_name, score, timestamp) VALUES (?, ?, ?)',
            (player_name, score, timestamp),
        )
        conn.commit()
        entry_id = cursor.lastrowid
        conn.close()
    except sqlite3.OperationalError as exc:
        log.error("DB write failed: %s", exc)
        return jsonify({'error': 'database unavailable'}), 503

    return jsonify({
        'id':          entry_id,
        'player_name': player_name,
        'score':       score,
        'timestamp':   timestamp,
    }), 201


@app.route('/api/scores', methods=['GET'])
def get_scores():
    """
    GET /api/scores[?limit=N]
    Returns the top N scores ordered by score DESC, timestamp ASC.
    Default limit: 10. Max limit: 1000.
    """
    limit_param = request.args.get('limit', None)
    if limit_param is None:
        limit = 10
    else:
        try:
            limit = int(limit_param)
            if limit < 0 or limit > 1000:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({'error': 'limit must be a non-negative integer'}), 400

    try:
        conn = get_db_connection()
        rows = conn.execute(
            'SELECT id, player_name, score, timestamp '
            'FROM scores '
            'ORDER BY score DESC, timestamp ASC '
            'LIMIT ?',
            (limit,),
        ).fetchall()
        conn.close()
    except sqlite3.OperationalError as exc:
        log.error("DB read failed: %s", exc)
        return jsonify({'error': 'database unavailable'}), 503

    return jsonify([dict(row) for row in rows]), 200


# ── Error handlers ───────────────────────────────────────────

@app.errorhandler(404)
def handle_not_found(exc):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'not found'}), 404
    return '<h1>404 — Not Found</h1>', 404


@app.errorhandler(400)
def handle_bad_request(exc):
    return jsonify({'error': 'bad request'}), 400


# ── Boot ─────────────────────────────────────────────────────

init_db()

if __name__ == '__main__': 
    port = int(os.environ.get("PORT", 5000))
    log.info(f"Starting PAC-BEAR server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=DEBUG_MODE)

FROM python:3.11-slim

WORKDIR /app

# Build tools for any native dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

# Create multitasking stub (yfinance dependency that fails to build via pip)
RUN python3 -c "
import site, os, json
site_dir = site.getsitepackages()[0]
pkg_dir = os.path.join(site_dir, 'multitasking')
os.makedirs(pkg_dir, exist_ok=True)
with open(os.path.join(pkg_dir, '__init__.py'), 'w') as f:
    f.write('''import threading, functools
_threads = []
_max_threads = 50

def set_max_threads(n=50):
    global _max_threads
    _max_threads = n

def task(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        t = threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True)
        t.start()
        _threads.append(t)
        return t
    return wrapper

class Task(threading.Thread):
    def __init__(self, fn, *args, **kwargs):
        super().__init__(target=fn, args=args, kwargs=kwargs, daemon=True)
''')
dist_dir = os.path.join(site_dir, 'multitasking-0.0.11.dist-info')
os.makedirs(dist_dir, exist_ok=True)
with open(os.path.join(dist_dir, 'METADATA'), 'w') as f:
    f.write('Metadata-Version: 2.1\nName: multitasking\nVersion: 0.0.11\n')
with open(os.path.join(dist_dir, 'top_level.txt'), 'w') as f:
    f.write('multitasking\n')
with open(os.path.join(dist_dir, 'RECORD'), 'w') as f:
    f.write('')
print('multitasking stub installed')
"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p data

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

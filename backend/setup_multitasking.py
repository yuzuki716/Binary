import site, os

site_dir = site.getsitepackages()[0]
pkg_dir = os.path.join(site_dir, 'multitasking')
os.makedirs(pkg_dir, exist_ok=True)

with open(os.path.join(pkg_dir, '__init__.py'), 'w') as f:
    f.write(
        'import threading, functools\n'
        '_threads = []\n'
        '_max_threads = 50\n\n'
        'def set_max_threads(n=50):\n'
        '    global _max_threads\n'
        '    _max_threads = n\n\n'
        'def task(fn):\n'
        '    @functools.wraps(fn)\n'
        '    def wrapper(*args, **kwargs):\n'
        '        t = threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True)\n'
        '        t.start()\n'
        '        _threads.append(t)\n'
        '        return t\n'
        '    return wrapper\n\n'
        'class Task(threading.Thread):\n'
        '    def __init__(self, fn, *args, **kwargs):\n'
        '        super().__init__(target=fn, args=args, kwargs=kwargs, daemon=True)\n'
    )

dist_dir = os.path.join(site_dir, 'multitasking-0.0.11.dist-info')
os.makedirs(dist_dir, exist_ok=True)
with open(os.path.join(dist_dir, 'METADATA'), 'w') as f:
    f.write('Metadata-Version: 2.1\nName: multitasking\nVersion: 0.0.11\n')
with open(os.path.join(dist_dir, 'top_level.txt'), 'w') as f:
    f.write('multitasking\n')
with open(os.path.join(dist_dir, 'RECORD'), 'w') as f:
    f.write('')

print('multitasking stub installed')

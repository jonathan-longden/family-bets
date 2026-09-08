"""Where the dataset is, and what its classes are.

The image and label directories are deliberately NOT in git: this repository
is published as-is by GitHub Pages, so a committed photograph is a public
download, and road photographs carry number plates and faces. The register
(sessions.csv, sources.csv) is committed because it is text and it is the part
that needs reviewing; the pixels live wherever you point DEFECTLOG_DATASET.

dataset.yaml is read with a deliberately small parser rather than PyYAML. It
is our own file in a shape we control, and a dependency that exists only to
read six lines is a dependency somebody has to install before they can check
their own data.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TRAINING = os.path.dirname(os.path.dirname(HERE))
DEFAULT_ROOT = os.path.join(TRAINING, 'dataset')

# The order is fixed by the shipped application, not by preference. app.js
# decodes channel 4 of the YOLO head as manhole and channel 5 as pothole, so a
# V2 trained with these swapped would load, run, and label every pothole a
# manhole. Changing this means changing the app's decoder in the same breath.
REQUIRED_NAMES = {0: 'manhole', 1: 'pothole'}


def root(explicit=None):
    return os.path.abspath(explicit or os.environ.get('DEFECTLOG_DATASET')
                           or DEFAULT_ROOT)


def paths(ds_root):
    return {
        'root': ds_root,
        'yaml': os.path.join(ds_root, 'dataset.yaml'),
        'sessions': os.path.join(ds_root, 'sessions.csv'),
        'sources': os.path.join(ds_root, 'sources.csv'),
        'incoming': os.path.join(ds_root, 'incoming'),
        'images': os.path.join(ds_root, 'images'),
        'labels': os.path.join(ds_root, 'labels'),
    }


def read_yaml(path):
    """(config, errors) for the restricted shape this pipeline writes."""
    if not os.path.exists(path):
        return None, ['dataset.yaml does not exist at ' + path]
    cfg, names, in_names = {}, {}, False
    with open(path, encoding='utf-8') as f:
        for n, raw in enumerate(f, start=1):
            line = raw.split('#', 1)[0].rstrip()
            if not line.strip():
                continue
            if line.startswith(' ') or line.startswith('\t'):
                if not in_names:
                    return None, ['dataset.yaml line %d: indented line outside '
                                  'names:' % n]
                key, _, val = line.strip().partition(':')
                try:
                    names[int(key)] = val.strip()
                except ValueError:
                    return None, ['dataset.yaml line %d: class key %r is not '
                                  'an integer' % (n, key)]
                continue
            in_names = False
            key, _, val = line.partition(':')
            key, val = key.strip(), val.strip()
            if key == 'names':
                in_names = True
                if val:
                    return None, ['dataset.yaml line %d: names: must be a '
                                  'block of "id: name" lines' % n]
                continue
            cfg[key] = val
    cfg['names'] = names
    return cfg, []


def check_names(names):
    """The one check that protects the shipped decoder."""
    errs = []
    for idx, want in REQUIRED_NAMES.items():
        got = names.get(idx)
        if got != want:
            errs.append('class %d must be %r for the app\'s decoder, found %r'
                        % (idx, want, got))
    extra = sorted(set(names) - set(REQUIRED_NAMES))
    if extra:
        errs.append('extra class ids %s — the app validates the head has '
                    'exactly %d classes and will reject the model'
                    % (extra, len(REQUIRED_NAMES)))
    return errs

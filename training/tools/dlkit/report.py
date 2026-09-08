"""The dataset report: what is actually in there, in one screen.

Written as text rather than a chart because it is meant to be pasted into a
message, diffed between two days, and read on a phone at the roadside.
"""
from . import sessions


def _pct(n, d):
    return '  -  ' if not d else '%4.0f%%' % (100.0 * n / d)


def lines(result):
    st = result.stats
    names = st['names']
    counts, boxes = st['counts'], st['boxes']
    total = sum(counts.values())
    L = []
    L.append('DEFECT LOG DATASET REPORT')
    L.append('root: ' + st['root'])
    L.append('')
    L.append('IMAGES')
    L.append('  total          %6d' % total)
    for s in sessions.SPLITS:
        L.append('  %-14s %6d   %s' % (s, counts[s], _pct(counts[s], total)))
    L.append('')

    L.append('ANNOTATIONS')
    tot_boxes = sum(boxes.values())
    for i in sorted(names):
        L.append('  %-14s %6d   %s'
                 % (names[i], boxes.get(i, 0), _pct(boxes.get(i, 0), tot_boxes)))
    L.append('  %-14s %6d' % ('all boxes', tot_boxes))
    L.append('')

    L.append('HARD NEGATIVES  (images with an empty label file)')
    L.append('  images         %6d   %s of the set'
             % (st['negatives'], _pct(st['negatives'], total)))
    for s in sessions.SPLITS:
        ps = st['per_split'][s]
        L.append('  %-14s %6d of %d' % (s, ps['negatives'], counts[s]))
    L.append('')

    L.append('PER SPLIT')
    L.append('  %-6s %7s %9s %9s %10s' %
             ('split', 'images', 'manhole', 'pothole', 'negatives'))
    for s in sessions.SPLITS:
        ps = st['per_split'][s]
        L.append('  %-6s %7d %9d %9d %10d'
                 % (s, counts[s], ps['counts'].get(0, 0),
                    ps['counts'].get(1, 0), ps['negatives']))
    L.append('')

    L.append('SESSIONS')
    by = {}
    for sid, row in st['sessions'].items():
        by.setdefault(row['split'], []).append(row)
    for split in sessions.ALL_SPLITS:
        rows = sorted(by.get(split, []), key=lambda r: r['session_id'])
        if not rows:
            continue
        L.append('  %s (%d)' % (split, len(rows)))
        for row in rows:
            L.append('    %-24s %-30s %s%s'
                     % (row['session_id'], (row['road'] or '')[:30],
                        row['captured_on'] or '',
                        '  PROTECTED' if row['protected'] == 'yes' else ''))
    L.append('')

    L.append('SOURCES AND LICENCE')
    for sid, row in sorted(st['sources'].items()):
        L.append('  %-22s %-20s commercial: %s'
                 % (sid, row['kind'], row['commercial_use']))
    L.append('')

    L.append('FINDINGS')
    for level in ('ERROR', 'WARN', 'INFO'):
        got = result.of(level)
        L.append('  %-6s %d' % (level, len(got)))
    L.append('')
    for f in result.findings:
        L.append('  %-5s %-20s %s' % (f.level, f.code, f.message))
    if not result.findings:
        L.append('  nothing to report')
    return L


def text(result):
    return '\n'.join(lines(result))

"""
MyChama shared library for Cloud Functions (mychama1 project).

Every callable, trigger and scheduled function imports from here rather than
redefining constants, types, fee math or path strings locally. See
docs/CONVENTIONS.md for the cross-repo consistency rules this package exists
to enforce.
"""

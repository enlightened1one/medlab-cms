import os
import sys
from pathlib import Path

os.environ.setdefault("ML_SERVICE_TOKEN", "test-token-only-not-a-real-secret-123456")
sys.path.insert(0, str(Path(__file__).parents[1]))

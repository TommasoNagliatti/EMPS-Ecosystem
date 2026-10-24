"""Single-process HTTP entry point for the containerized multistation service."""
import os

import uvicorn

from gie_multistation.api import create_app


def main():
    uvicorn.run(create_app(), host=os.environ.get('GIE_BIND_HOST', '127.0.0.1'),
                port=int(os.environ.get('GIE_API_PORT', '8520')), workers=1,
                access_log=False)


if __name__ == '__main__':
    main()

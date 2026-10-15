"""Authenticated local healthcheck without exposing the service token."""
import json
import os
import urllib.request


def main():
    scopes = json.loads(os.environ['GIE_MULTISTATION_TOKENS'])
    token = next(iter(scopes))
    port = int(os.environ.get('GIE_API_PORT', '8520'))
    request = urllib.request.Request('http://127.0.0.1:%d/v1/health' % port,
                                     headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=4) as response:
        health = json.load(response)
    if health.get('status') != 'ok' or health.get('physical_dispatch') is not False:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

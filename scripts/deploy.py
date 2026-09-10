#!/usr/bin/env python
"""Deploy MolfGraph to GenLayer StudioNet.

Two ways to supply the signing key. The keystore route is preferred: the
password is typed straight into your terminal, is never echoed, never reaches
the command line, and is never written anywhere.

    # 1. Encrypted keystore (default). Uses the active account from
    #    ~/.genlayer/genlayer-config.json unless --keystore names another.
    python scripts/deploy.py

    # 2. A raw private key in the environment, for CI or a throwaway account.
    #    Put it in .env at the repo root, which is gitignored.
    GENLAYER_PRIVATE_KEY=0x<64 hex characters>

It deploys ``contracts/molfgraph.py``, which is the canonical source and is
byte-identical to what is live on StudioNet. The VecDB variant in
``contracts/molfgraph_vecdb.py`` is NOT deployable: the dual ``Seq`` magic
header it needs is rejected by the GenVM.

On success the script prints the deployed address, writes it into
``frontend/.env``, and reads three views back off the chain to prove the
contract is live.

Pass --dry-run to check the key, the balance, and the RPC without deploying.
The decrypted key is held in memory only and is never printed or persisted.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "molfgraph.py"
FRONTEND_ENV = ROOT / "frontend" / ".env"

RPC_URL = "https://studio.genlayer.com/api"
EXPLORER = "https://genlayer-explorer.vercel.app"
KEY_VAR = "GENLAYER_PRIVATE_KEY"

GENLAYER_HOME = pathlib.Path.home() / ".genlayer"
KEYSTORE_DIR = GENLAYER_HOME / "keystores"
GENLAYER_CONFIG = GENLAYER_HOME / "genlayer-config.json"


def load_dotenv_if_present() -> None:
    """Read .env without adding a dependency, and without overriding real env."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def is_interactive() -> bool:
    """True only at a real terminal.

    ``sys.stdin.isatty()`` alone is not enough: under some Windows shells it
    reports True even when stdin is the null device, and ``getpass`` on Windows
    then blocks forever reading the console. Requiring stdout to be a terminal
    too, and honouring an explicit opt-out, keeps this script safe to run from
    automation.
    """
    if os.environ.get("MOLFGRAPH_NONINTERACTIVE"):
        return False
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except Exception:
        return False


def normalise_key(key: str, source: str) -> str:
    key = key.strip()
    if not key.startswith("0x"):
        key = "0x" + key
    body = key[2:]
    if len(body) != 64 or any(c not in "0123456789abcdefABCDEF" for c in body):
        sys.exit(f"{source} must be 64 hex characters, with or without the 0x prefix.")
    return key


def resolve_keystore(name: str | None) -> pathlib.Path | None:
    """Find the keystore file to use: explicit name, then the active account."""
    if name:
        candidate = pathlib.Path(name)
        if candidate.exists():
            return candidate
        candidate = KEYSTORE_DIR / (name if name.endswith(".json") else name + ".json")
        return candidate if candidate.exists() else None

    if GENLAYER_CONFIG.exists():
        try:
            active = json.loads(GENLAYER_CONFIG.read_text(encoding="utf-8")).get("activeAccount")
        except Exception:
            active = None
        if active:
            candidate = KEYSTORE_DIR / f"{active}.json"
            if candidate.exists():
                return candidate

    if KEYSTORE_DIR.is_dir():
        found = sorted(KEYSTORE_DIR.glob("*.json"))
        if len(found) == 1:
            return found[0]
    return None


def key_from_keystore(path: pathlib.Path) -> str:
    """Decrypt a V3 keystore. The password is read from the terminal only."""
    from eth_account import Account

    try:
        keystore = json.loads(path.read_text(encoding="utf-8"))
    except Exception as cause:
        sys.exit(f"Could not read keystore {path}: {cause}")

    address = keystore.get("address", "")
    if address and not address.startswith("0x"):
        address = "0x" + address
    print(f"keystore  : {path.name}  ({address or 'address not recorded'})")

    if not is_interactive():
        sys.exit(
            "This keystore is encrypted and its password must be typed at a real\n"
            "terminal. Nothing was sent.\n\n"
            "Run this script yourself in an interactive shell:\n\n"
            "    python scripts/deploy.py\n\n"
            f"Alternatively set {KEY_VAR} in {ROOT / '.env'} and rerun."
        )

    password = getpass.getpass("keystore password (not echoed, not stored): ")
    try:
        private_key = Account.decrypt(keystore, password).hex()
    except Exception:
        sys.exit("Wrong password, or the keystore is not a valid V3 file. Nothing was sent.")
    finally:
        del password
    return normalise_key(private_key, "The decrypted keystore key")


def read_key(keystore_name: str | None, prefer_env: bool) -> str:
    env_key = (os.environ.get(KEY_VAR) or "").strip()
    if env_key and prefer_env:
        return normalise_key(env_key, KEY_VAR)

    path = resolve_keystore(keystore_name)
    if path:
        return key_from_keystore(path)

    if env_key:
        return normalise_key(env_key, KEY_VAR)

    sys.exit(
        "No signing key found.\n\n"
        "MolfGraph signs its own deploy transaction, so it needs a private key.\n"
        "An unlocked browser wallet is not reachable from this process.\n\n"
        f"Either place an encrypted keystore in {KEYSTORE_DIR},\n"
        f"or create {ROOT / '.env'} containing:\n\n"
        f"    {KEY_VAR}=0x<your 64-hex-character key>\n\n"
        "then run this script again. That file is already in .gitignore."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy MolfGraph to StudioNet.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check the key, RPC and balance without sending a transaction.",
    )
    parser.add_argument(
        "--keystore",
        metavar="NAME_OR_PATH",
        help="Keystore to sign with. Defaults to the active account in "
             "~/.genlayer/genlayer-config.json.",
    )
    parser.add_argument(
        "--use-env-key",
        action="store_true",
        help=f"Prefer {KEY_VAR} over the keystore.",
    )
    args = parser.parse_args()

    load_dotenv_if_present()
    key = read_key(args.keystore, args.use_env_key)

    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet

    account = create_account(key)
    client = create_client(chain=studionet, account=account)

    print(f"network   : {studionet.name} (chain {studionet.id})")
    print(f"rpc       : {RPC_URL}")
    print(f"deployer  : {account.address}")

    balance = client.get_balance(account.address)
    print(f"balance   : {balance}")
    if balance == 0:
        print(
            "\nWarning: the deployer balance is zero. Fund it from the StudioNet "
            "faucet before deploying, or the transaction will fail."
        )

    code = CONTRACT.read_text(encoding="utf-8")
    print(f"contract  : {CONTRACT.relative_to(ROOT)} ({len(code.encode()):,} bytes)")

    if args.dry_run:
        print("\nDry run only. Nothing was sent.")
        return

    print("\nDeploying…")
    tx_hash = client.deploy_contract(code=code, account=account, args=[])
    print(f"tx        : {tx_hash}")

    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash, status="FINALIZED", interval=5000, retries=90
    )
    address = (
        receipt.get("data", {}).get("contract_address")
        or receipt.get("contract_address")
        or ""
    )
    if not address:
        print("\nDeployment finished but no contract address came back. Full receipt:")
        print(receipt)
        sys.exit(1)

    print(f"address   : {address}")
    print(f"explorer  : {EXPLORER}/address/{address}")

    FRONTEND_ENV.write_text(
        f"VITE_MOLFGRAPH_CONTRACT_ADDRESS={address}\n"
        f"VITE_GENLAYER_RPC={RPC_URL}\n",
        encoding="utf-8",
    )
    print(f"wrote     : {FRONTEND_ENV.relative_to(ROOT)}")

    print("\nReading state back off the chain:")
    for fn in ("get_owner", "get_disclaimer", "get_stats"):
        value = client.read_contract(address=address, function_name=fn, args=[])
        print(f"  {fn}: {str(value)[:160]}")

    print("\nDone. Start the console with:  cd frontend && npm run dev")


if __name__ == "__main__":
    main()

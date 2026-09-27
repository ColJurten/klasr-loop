import argparse
import json

from . import suggest_directory, suggest_filename


def filename_main() -> None:
    parser = argparse.ArgumentParser(prog="suggest_filename")
    parser.add_argument("-f", "--file", required=True)
    args = parser.parse_args()
    print(suggest_filename(args.file).model_dump_json())


def directory_main() -> None:
    parser = argparse.ArgumentParser(prog="suggest_directory")
    parser.add_argument("-f", "--file", required=True)
    parser.add_argument("-d", "--directories", required=True)
    args = parser.parse_args()
    directories = json.loads(args.directories)
    if not isinstance(directories, list) or not all(isinstance(path, str) for path in directories):
        parser.error("--directories must be a JSON array of paths")
    print(suggest_directory(args.file, directories).model_dump_json())

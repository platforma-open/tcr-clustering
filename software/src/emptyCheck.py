import pandas as pd
import argparse
import os

def main():
    parser = argparse.ArgumentParser(
        description='Check if input table is empty.',
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('-i', '--input', required=True,
                        help='Input file')
    parser.add_argument('-s', '--input-separator', default='\t',
                        help='Input table file separator (default: "\t")')
    parser.add_argument('--output-dir', default='.',
                        help='Directory to save output files (default: current directory)')
    args = parser.parse_args()

    # Determine emptiness cheaply: read only the first data row (nrows=1) so a large input is never
    # loaded in full. df.empty is True iff there were zero data rows. A 0-byte / header-less file
    # raises EmptyDataError, which we also treat as empty.
    try:
        df_input = pd.read_csv(args.input, sep=args.input_separator, dtype=str, nrows=1)
        if df_input.empty:
            print("Input table is empty.")
            fileContent = "empty"
        else:
            print("Input table is not empty.")
            fileContent = "notEmpty"
    except pd.errors.EmptyDataError:
        print("Input table is empty (no data or header).")
        fileContent = "empty"

    with open(os.path.join(args.output_dir, 'isFileEmpty.txt'), 'w') as f:
        f.write(fileContent)

if __name__ == '__main__':
    main()
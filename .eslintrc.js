module.exports = {
  "env": {
    "browser": true,
    "es6": true
  },
  "extends": [
    "standard",
    "plugin:@typescript-eslint/eslint-recommended"
  ],
  "globals": {
    "Atomics": "readonly",
    "SharedArrayBuffer": "readonly"
  },
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2018,
    "project": "tsconfig.json",
    "sourceType": "module"
  },
  "plugins": [
    "chai-friendly",
    "@typescript-eslint",
    "@typescript-eslint/tslint"
  ],
  "rules": {
    "brace-style": "off",
    "@typescript-eslint/brace-style": "off",
    "@typescript-eslint/class-name-casing": "error",
    "@typescript-eslint/consistent-type-definitions": "error",
    "@typescript-eslint/explicit-member-accessibility": [
      "off",
      {
        "accessibility": "explicit"
      }
    ],
    "handle-callback-err": "off",
    "indent": "off",
    "@typescript-eslint/indent": [
      "error",
      2,
      {
        "ArrayExpression": "first",
        "FunctionDeclaration": { parameters: "first" },
        "ignoredNodes": [
          "ArrowFunctionExpression > BlockStatement",
          "ClassProperty *",
          "NoSubstitutionTemplateLiteral",
          "TemplateLiteral",
          "TSTypeAliasDeclaration *"
        ],
        "ObjectExpression": "first",
        "VariableDeclarator": "first",
        "SwitchCase": 1
      }
    ],
    "@typescript-eslint/member-delimiter-style": [
      "error",
      {
        "multiline": {
          "delimiter": "semi",
          "requireLast": true
        },
        "singleline": {
          "delimiter": "semi",
          "requireLast": false
        }
      }
    ],
    "@typescript-eslint/member-ordering": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-empty-interface": "error",
    "@typescript-eslint/no-inferrable-types": "error",
    "@typescript-eslint/no-misused-new": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-use-before-define": "off",
    "@typescript-eslint/prefer-function-type": "error",
    "@typescript-eslint/quotes": [
      "error",
      "single",
      {
        "avoidEscape": true
      }
    ],
    "@typescript-eslint/semi": [
      "error",
      "always"
    ],
    "@typescript-eslint/type-annotation-spacing": "error",
    "@typescript-eslint/unified-signatures": "error",
    "arrow-body-style": "error",
    "camelcase": "off",
    "comma-dangle": [
      "error",
      {
        "arrays": "only-multiline",
        "objects": "only-multiline",
        "imports": "only-multiline",
        "exports": "only-multiline",
        "functions": "never"
      }
    ],
    "constructor-super": "error",
    "curly": "off",
    "dot-notation": "off",
    "eol-last": "error",
    "eqeqeq": [
      "error",
      "smart"
    ],
    "guard-for-in": "error",
    "id-blacklist": "off",
    "id-match": "off",
    "import/no-deprecated": "warn",
    "max-len": [
      "error",
      {
        "code": 200
      }
    ],
    "no-bitwise": "off",
    "no-caller": "error",
    "no-console": [
      "error",
      {
        "allow": [
          "log",
          "warn",
          "dir",
          "error"
        ]
      }
    ],
    "no-control-regex": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-eval": "error",
    "no-fallthrough": "error",
    "no-mixed-operators": [
      "error",
      {
        "groups": [
          ["&", "|", "^", "~", "<<", ">>", ">>>"],
          ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
          ["in", "instanceof"]
        ]
      }
    ],
    "no-multi-spaces": [
      "error",
      {
        "exceptions": {
          "SwitchCase": true
        },
        "ignoreEOLComments": true
      }
    ],
    "no-new-wrappers": "error",
    "no-return-assign": "off",
    "no-shadow": [
      "error",
      {
        "hoist": "all"
      }
    ],
    "no-throw-literal": "error",
    "no-trailing-spaces": "error",
    "no-undef-init": "error",
    "no-underscore-dangle": "off",
    "no-unused-expressions": "off",
    "chai-friendly/no-unused-expressions": 2,
    "no-unused-labels": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "vars": "all",
        "args": "after-used",
        "ignoreRestSiblings": false
      }
    ],
    "no-useless-constructor": "off",
    "@typescript-eslint/no-useless-constructor": "error",
    "no-var": "error",
    "object-curly-newline": "off",
    "operator-linebreak": "off",
    "prefer-const": [
      "error",
      {
        "destructuring": "all"
      }
    ],
    "radix": "error",
    "semi": [
      "error",
      "always"
    ],
    "space-before-function-paren": [
      "error",
      {
        "anonymous": "always",
        "named": "never",
        "asyncArrow": "always"
      }
    ],
    "spaced-comment": "error",
    "yoda": [
      "error",
      "never",
      {
        "exceptRange": true
      }
    ]
  }
};

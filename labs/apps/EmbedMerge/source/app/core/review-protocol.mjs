// Transport contract only. Skills and inference belong to the calling AI.
export const protocolVersion=1;
export const reportSchema={
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "priority": {
            "type": "string",
            "enum": [
              "high",
              "medium",
              "low"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "confirmed",
              "needs-confirmation",
              "advisory",
              "missing-evidence"
            ]
          },
          "parameter": {
            "type": "string"
          },
          "current": {
            "type": "string"
          },
          "recommendation": {
            "type": "string"
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "location": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "quote": {
                "type": "string"
              }
            },
            "required": [
              "path",
              "version",
              "quote"
            ],
            "additionalProperties": false
          },
          "relatedLocations": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "type": "object",
              "properties": {
                "path": {
                  "type": "string"
                },
                "version": {
                  "type": "string"
                },
                "quote": {
                  "type": "string"
                }
              },
              "required": [
                "path",
                "version",
                "quote"
              ],
              "additionalProperties": false
            }
          },
          "proposal": {
            "type": "object",
            "properties": {
              "before": {
                "type": "string"
              },
              "after": {
                "type": "string"
              }
            },
            "required": [
              "before",
              "after"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "id",
          "title",
          "priority",
          "status",
          "parameter",
          "current",
          "recommendation",
          "evidence"
        ],
        "additionalProperties": false
      }
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "limitations": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "title",
    "findings",
    "checks",
    "limitations"
  ],
  "additionalProperties": false
};
export const reviewCommandSpec={name:'review_command',description:'Create a pending review request for the external AI. EmbedMerge never reads skills or starts review inference. This only requests review, never claim completion.',inputSchema:{type:'object',properties:{target:{type:'string'},side:{type:'string',enum:['ref','test']},requirementsRel:{type:'string'},scope:{type:'string',enum:['basic','full']}},required:['target','side'],additionalProperties:false}};

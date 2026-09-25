let conditions = [
                    {
                        "type": "URL",
                        "condition": "contains",
                        "value": "https://stage.friender.io/posts/all?tab=scheduled"
                    }
                ]

let config=  {
    "event_type": "standard",
    "event_name": "pii_page_visited",
    "data": {
        "url": "https://stage.friender.io/posts/all?tab=scheduled&fr_hash=7385fd9179e6cac2c562874d395f58045f16d635e279075928037c69a84b6226",
        "referrer": "",
        "title": "Friender"
    },
    "url": "https://stage.friender.io/posts/all?tab=scheduled&fr_hash=7385fd9179e6cac2c562874d395f58045f16d635e279075928037c69a84b6226",
    "sale_value": null,
    "custom_event_name": null
}

const getFilter = async (operator, value, field, user_id) => {
    let condition;
    if (field == "friendName" || "country" || "campaign_name") {
        value = decodeURIComponent(value);
    } else if (field == "friendGender" || field == "gender") {
        condition = { [field]: value };
        if (value == "NA") {
            condition = { [field]: "UNKNOWN" };
        }
    }
    if (operator === "contains") {
        if (field == "age" || field == "recent_engagement" || field == "total_engagement" || field == "reactionThread" || field == "commentThread" || field == "message_thread") {
            condition = { [field]: Number(value) };
        } else {
            condition = { [field]: { $regex: `.*${value}.*`, $options: "i" } };
        }
    } else if (operator === "empty") {
        condition = { [field]: value };
        if (field == "postText") {
            condition = { [field]: null };
        }
    } else if (operator === "not_empty") {
        condition = { [field]: { $nin: ["", null] } };
    } else if (operator === "not_contains") {
        condition = { [field]: { $not: { $regex: `.*${value}.*`, $options: "i" } } };
    } else if (operator === "equals") {
        if (field === "age" || field === "recent_engagement" || field === "friendship") {
            condition = { [field]: Number(value) };
        } else {
            condition = { [field]: value };
        }
    } else if (operator === "not_equal") {
        if (field === "age" || field === "recent_engagement") {
            condition = { [field]: { $ne: Number(value) } };
        } else condition = { [field]: { $ne: value } };
    } else if (operator === "starts_with") {
        condition = { [field]: { $regex: `^${value}`, $options: "i" } };
    } else if (operator === "ends_with") {
        condition = { [field]: { $regex: `${value}$`, $options: "i" } };
    } else if (operator === "blank") {
        condition = { [field]: { $exists: false } };
    } else if (operator === "not_blank") {
        condition = { [field]: { $exists: true } };
    } else if (operator === "less_than") {
        condition = { [field]: { $lt: Number(value) } };
    } else if (operator === "greater_than") {
        condition = { [field]: { $gt: Number(value) } };
    } else if (operator === "less_than_or_equals") {
        condition = { [field]: { $lte: Number(value) } };
    } else if (operator === "greater_than_or_equals") {
        condition = { [field]: { $gte: Number(value) } };
    } else if (operator === "multi_select") {
        value = value.split(",");
        if (field == "label" || field == "tags") {
            for (let i = 0; i < value.length; i++) {
                value[i] = await mongo.makeId(value[i]);
            }
        } else if(field != "matchedKeyword" ) {
            for (let i = 0; i < value.length; i++) {
                value[i] = Number(value[i]);
            }
        } 
        condition = { [field]: { $in: value } };
    }
    if (field == "friendGender" || field == "gender") {
        condition = { [field]: value.toUpperCase() };
        if (value == "NA") {
            condition = { [field]: "UNKNOWN" };
        }
    }
    if (field === "recent_engagement"  && operator === "contains") {
        if(value.toLowerCase() === "never"){
          condition = { [field]: null };
        } else if(value.toLowerCase() === "active"){

            await mongo.init(
                process.env.DATABASE_READ_HOST,
                10,
                process.env.DATABASE_NAME,
                "user_profile_settings"
            );

            let settings =  await mongo.findOne({ user_id })


           condition = { [field]: {$lte : settings?.friends_willbe_inactive_after} };
        } else if(value.toLowerCase() === "inactive"){

            await mongo.init(
                process.env.DATABASE_READ_HOST,
                10,
                process.env.DATABASE_NAME,
                "user_profile_settings"
            );

            let settings =  await mongo.findOne({ user_id })


            condition = {
                    $or: [
                        { [field]: { $gt: settings?.friends_willbe_inactive_after } },
                        { [field]: null }
                    ]
            };
        }
        
    } 
    if(operator === 'hasLabel'){
        console.log("value", value);
        let labels = [];
        if(value == "ANY"){
            condition = { [field]: {$nin: labels}} //using $nin as we have take all labels
        }else{
            value =value.split(',').map(v => v.trim());
            labels = await Promise.all(value.map(elem => mongo.makeId(elem)));
            condition = { [field]: {$in: labels}}
        }
    }
    if(operator === 'doesNothaveLabel'){
        let labels = [];
        if(value == "ANY"){
            // get default label
            await mongo.init(process.env.DATABASE_READ_HOST, 10, process.env.DATABASE_NAME, "labels");
            let defaultLabel = await mongo.findOne({ user_id, title:"Unlabeled"}) 
            labels = [defaultLabel._id]
            condition = { [field]: {$in: labels}} //using $nin as we have take all labels
        }else{
        value =value.split(',').map(v => v.trim());
        let labels = await Promise.all(value.map(elem => mongo.makeId(elem)));
        condition = { [field]: {$nin: labels}}
        }
    }
    if(operator === 'hasTags'){
        let tags = [];
        if(value == "ANY"){
            condition = { ['tags']: {$nin: tags}} //using $nin as we have take all labels
        }else{
            value =value.split(',').map(v => v.trim());
            tags = await Promise.all(value.map(elem => mongo.makeId(elem)));
            condition = { ['tags']: {$in: tags}}
        }
    }
    if(operator === 'doesNothaveTags'){
        value =value.split(',').map(v => v.trim());
        let tags = await Promise.all(value.map(elem => mongo.makeId(elem)));
        condition = { ['tags']: {$nin: tags}}
    }

    return condition;
};




const getEventFieldValue = ({ conditionType, config }) => {
    if (conditionType === "URL") return config?.url;
    if (conditionType === "sale_amount") return config?.sale_value;
    if (conditionType === "custom_event")  return config?.custom_event_name;;
    return null;
};

const checkExpressionMatch = ({ expression, fieldValue }) => {
    if (expression === null || expression === undefined) {
        return fieldValue === expression;
    }

    if (typeof expression !== "object" || Array.isArray(expression)) {
        return String(fieldValue ?? "") === String(expression);
    }

    console.log(expression, fieldValue); 
 
    if (expression.$regex !== undefined) {
        let pattern = expression.$regex;

        // Preserve wildcard tokens temporarily
        pattern = pattern.replace(/\.\*/g, "__WILDCARD__");

        // Escape all regex special characters
        pattern = pattern.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        // Restore wildcard tokens
        pattern = pattern.replace(/__WILDCARD__/g, ".*");
 
        const regex = new RegExp(pattern, expression.$options || "");

        return regex.test(String(fieldValue ?? ""));
    }
    if (expression.$not?.$regex !== undefined) {
        const regex = new RegExp(expression.$not.$regex, expression.$not.$options || "");
        return !regex.test(String(fieldValue ?? ""));
    }
    if (expression.$gt !== undefined) return Number(fieldValue) > Number(expression.$gt);
    if (expression.$gte !== undefined) return Number(fieldValue) >= Number(expression.$gte);
    if (expression.$lt !== undefined) return Number(fieldValue) < Number(expression.$lt);
    if (expression.$lte !== undefined) return Number(fieldValue) <= Number(expression.$lte);
    if (expression.$ne !== undefined) return String(fieldValue ?? "") !== String(expression.$ne);
    if (expression.$in !== undefined) return Array.isArray(expression.$in) && expression.$in.map(String).includes(String(fieldValue ?? ""));
    if (expression.$nin !== undefined) return Array.isArray(expression.$nin) && !expression.$nin.map(String).includes(String(fieldValue ?? ""));
    if (expression.$exists !== undefined) {
        const exists = fieldValue !== undefined && fieldValue !== null;
        return expression.$exists ? exists : !exists;
    }

    return false;
};

const getMatchCondition = async ({ conditions, config, user_id }) => {
    const conditionList = Array.isArray(conditions) ? conditions : [];
    if (!conditionList.length) return false;

    for (const condition of conditionList) {
        const field = condition?.type;
        const eventValue = getEventFieldValue({ conditionType: field, config });
        const filterQuery = await getFilter(condition?.condition, condition?.value, field, user_id);
        if (!filterQuery || typeof filterQuery !== "object") continue;

        const queryField = Object.keys(filterQuery).find((key) => key !== "$or");
        if (queryField && checkExpressionMatch({ expression: filterQuery[queryField], fieldValue: eventValue })) {
            return true; // OR semantics across condition objects
        }
    } 

    return false;
}

function test(){
  getMatchCondition({
    conditions,
    config  });
}

console.log("Starting test...");
test(); checkExpressionMatch
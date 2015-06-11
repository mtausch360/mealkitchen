var Promise = require('bluebird');
var http = require('http');
var Recipe = require('./recipeModel');
var RecipePreference = require('../recipePreference/recipePreferenceModel');
var db = require('../db');
var lib = require('../config/libraries');
var MealPlan = require('../mealPlan/mealPlanModel');
var utils = require('../config/utility');
var RecipePreferenceController = require('../recipePreference/RecipePreferenceController');

var appId, apiKey;
try {
  appId = process.env.APPLICATION_ID || require('../config/config.js').APPLICATION_ID;
  apiKey = process.env.APPLICATION_KEY || require('../config/config.js').APPLICATION_KEY;
} 
catch (e) {
  appId = 12345;
  apiKey = 98765;
}

var writeQueries = function(queryModel, userFlavorPrefs){
  console.log('writeQueries queryModel', queryModel);
  console.log('userFlavorPrefs')
  var allowedAllergyList = queryModel.allowedAllergies;
  var allowedCuisineList = queryModel.allowedCuisines;
  var allowedDietList = queryModel.allowedDiet;

  //handling stringified number values from client so as to not concatenate 10
  queryModel.numBreakfasts *= 1;
  queryModel.numLunches *= 1;
  queryModel.numDinners *= 1;

  // If number of course meals specified, add 10 meals for queueing functionality
  var numBreakfasts = queryModel.numBreakfasts && queryModel.numBreakfasts + 10;
  var numLunches =  queryModel.numLunches && queryModel.numLunches + 10;
  var numDinners =  queryModel.numDinners && queryModel.numDinners + 10;


  //will likely have to track additional requests for each course
  var start = queryModel.additionalRequest ? queryModel.totalRecipesRequested : 0;

  var breakfastQueryString, lunchQueryString, dinnerQueryString;
  var queryString = '', newQueryProp = true;

  if(allowedAllergyList){
    queryString += "&allowedAllergy[]=";
  }
  for (var key in allowedAllergyList) {
    if (allowedAllergyList[key]) {
      if(newQueryProp){
        queryString += "&allowedAllergy[]=";
        newQueryProp = false;
      }
      else{
        queryString += '&';
      }
      queryString += lib.allowedAllergyLibrary[key];
    }
  }
  newQueryProp = true;

  for (key in allowedCuisineList) {
    if (allowedCuisineList[key]) {
      if(newQueryProp){
        queryString += "&allowedCuisine[]=";
        newQueryProp = false;
      }
      else{
        queryString += '&';
      }
      queryString +=  lib.allowedCuisineLibrary[key];
    }
  }
  newQueryProp = true;

  for (key in allowedDietList) {
    if (allowedDietList[key]) {
      if(newQueryProp){
        queryString += "&allowedDiet[]=";
        newQueryProp = false;
      }
      else{
        queryString += '&';
      }
      queryString += lib.allowedDietLibrary[key];
    }
  }

  // TO-DO: Add ranges to query for user preferences
  // "&flavor.salty.min=" + 0.8 + "&flavor.salty.max=" + 1 +
  // "&flavor.sour.min=" + 0.8 + "&flavor.sour.max=" + 1 +
  // "&flavor.sweet.min=" + 0.8 + "&flavor.sweet.max=" + 1 +
  // "&flavor.bitter.min=" + 0.8 + "&flavor.bitter.max=" + 1 +
  // "&flavor.meaty.min=" + 0.8 + "&flavor.meaty.max=" + 1 +
  // "&flavor.piquant.min=" + 0 + "&flavor.piquant.max=" + 0.2


  breakfastQueryString = numBreakfasts > 0 ?
    "http://api.yummly.com/v1/api/recipes?_app_id=" + appId +
    "&_app_key=" + apiKey +
    queryString + "&allowedCourse[]=" + lib.course.Breakfast + "&requirePictures=true" +
    "&maxResult=" + numBreakfasts + "&start=" + start : "";

  lunchQueryString = numLunches > 0 ?
    "http://api.yummly.com/v1/api/recipes?_app_id=" + appId +
    "&_app_key=" + apiKey +
    queryString + "&allowedCourse[]=" + lib.course.Lunch + "&requirePictures=true" +
    "&maxResult=" + numLunches + "&start=" + start : "";

  dinnerQueryString = numDinners > 0 ?
    "http://api.yummly.com/v1/api/recipes?_app_id=" + appId +
    "&_app_key=" + apiKey +
    queryString + "&allowedCourse[]=" + lib.course.Dinner + "&requirePictures=true" +
    "&maxResult=" + numDinners + "&start=" + start : "";

  return {
    'breakfastQuery': breakfastQueryString,
    'lunchQuery': lunchQueryString,
    'dinnerQuery': dinnerQueryString
  };
};

var queryYummly = function(queryString){

  return new Promise(function(resolve, reject){
    var results;
    //no meals entered for param; query is empty string
    if (!queryString) {
      resolve([]);
    } else {

      http.get(queryString, function(yummlyResponse){
        var str = '';

        yummlyResponse.on('data', function (chunk) {
          str += chunk;
        });

        yummlyResponse.on('end', function () {
          results = JSON.parse(str);
          resolve(results.matches);

        });
        yummlyResponse.on('error', function(error){
          reject(error);

        })
      });
    }
  });
};

var getToYummlyById = function(recipeId){
  return new Promise(function(resolve, reject){
    var str = "";
    var recipe;

    var query = "http://api.yummly.com/v1/api/recipe/" + recipeId +
    "?_app_id=" + appId + "&_app_key=" + apiKey;

    http.get(query, function(yummlyResponse) {

      yummlyResponse.on('data', function (chunk) {
        str += chunk;
      });

      yummlyResponse.on('end', function () {
        recipe = JSON.parse(str);
        recipe.matchId = recipeId;
        resolve(recipe)
      });

      yummlyResponse.on('error', function(error) {
        reject({'error in fetchRecipeById': error});
      });
    });
  });
}

//fetch recipe from database first or from yummly if not found
var fetchRecipeById = function (recipeId) {
  return new Promise(function(resolve, reject){
    new Recipe({matchId: recipeId}).fetch().then(function(found){
      if(!found){
        getToYummlyById(recipeId)
        .then(function(recipe){
          resolve(recipe);
        })
        .catch(function(error){
          reject({'error in getToYummlyById': error})
        })
      }
      else{
        //returned fetched recipe
        resolve(found);
      }
    });
  })
}

//takes an array of recipe ids and will make individual get requests from yummly
var fetchRecipesByIds = function(recipeIds){
  return new Promise(function(resolve, reject){
    var promises = [];
    for(var i = 0; i < recipeIds.length; i++){
      promises.push(fetchRecipeById(recipeIds[i]));
    }

    Promise.all(promises)
    .then(function(fetchedRecipes){
      resolve(fetchedRecipes);
    })
    .catch(function(error){
      console.log('error in array recipe', error);
      reject({'error in fetchRecipesByIds': error});
    })
  });
}



var saveRecipe = function(recipe, course){
  return new Promise(function(resolve, reject){
    new Recipe({'id': recipe.id}).fetch().then(function(found){
      if(!found){
        var newRecipe = new Recipe({
          'id': recipe.id,
          'matchId': recipe.matchId,
          'recipeName': recipe.name,
          'sourceDisplayName': recipe.sourceDisplayName,
          'smallImgUrl': recipe.images && recipe.images[0].hostedSmallUrl,
          'largeImgUrl': recipe.images && recipe.images[0].hostedLargeUrl,
          'cuisine': recipe.attributes.cuisine,
          'course': course,
          'holiday': recipe.attributes.holiday,
          'totalTimeInSeconds': recipe.totalTimeInSeconds,
          'ingredients':  recipe.ingredientLines.join('|'),
          'rating':recipe.rating,
          'salty': recipe.flavors && recipe.flavors.salty,
          'sour': recipe.flavors && recipe.flavors.sour,
          'sweet':recipe.flavors && recipe.flavors.sweet,
          'bitter':recipe.flavors && recipe.flavors.bitter,
          'piquant':recipe.flavors && recipe.flavors.piquant,
          'meaty': recipe.flavors && recipe.flavors.meaty
        }).save({}, {method: 'insert'})
        .then(function(){
          resolve()
        })
        .catch(function(error) {
          reject({'error': error});
        });
      } else {
        resolve()
      }
    });
  });
}

var getUserFlavorPrefs = function (userid) {
  
  return new Promise(function(resolve, reject) {
    var userFlavorPrefs = {};

    RecipePreferenceController.getUserPreferences(userid).then(function(preferences){
      console.log("getUserFlavorPrefs results: ", preferences);
      var saltyTotal = 0;
      var sourTotal = 0;
      var sweetTotal = 0;
      var bitterTotal = 0;
      var meatyTotal = 0;
      var piquantTotal = 0;
      var counter = 0;

      for (var i = 0; i < preferences.length; i++){
        var preferenceAttr = preferences[i].attributes;
        if (preferenceAttr.salty && preferenceAttr.sour && preferenceAttr.sweet && preferenceAttr.bitter && preferenceAttr.meaty && preferenceAttr.piquant) {
          console.log('preference Attributes: ', preferenceAttr);
          saltyTotal += preferenceAttr.salty;
          sourTotal += preferenceAttr.sour;
          sweetTotal += preferenceAttr.sweet;
          bitterTotal += preferenceAttr.bitter;
          meatyTotal += preferenceAttr.meaty;
          piquantTotal += preferenceAttr.piquant;
          counter++;
        }
      }

      var saltyAvg = saltyTotal / counter;
      var sourAvg = sourTotal / counter;
      var sweetAvg = sweetTotal / counter;
      var bitterAvg = bitterTotal / counter;
      var meatyAvg = meatyTotal / counter;
      var piquantAvg = piquantTotal / counter;

      userFlavorPrefs = {
        "salty": [(saltyAvg - 0.1) > 0 ? saltyAvg - 0.1 : 0, (saltyAvg + 0.1) < 1 ? saltyAvg + 0.1 : 1],
        "sour": [(sourAvg - 0.1) > 0 ? sourAvg - 0.1 : 0, (sourAvg + 0.1) < 1 ? sourAvg + 0.1 : 1],
        "sweet": [(sweetAvg - 0.1) > 0 ? sweetAvg - 0.1 : 0, (sweetAvg + 0.1) < 1 ? sweetAvg + 0.1 : 1],
        "bitter": [(bitterAvg - 0.1) > 0 ? bitterAvg - 0.1 : 0, (bitterAvg + 0.1) < 1 ? bitterAvg + 0.1 : 1],
        "meaty": [(meatyAvg - 0.1) > 0 ? meatyAvg - 0.1 : 0, (meatyAvg + 0.1) < 1 ? meatyAvg + 0.1 : 1],
        "piquant": [(piquantAvg - 0.1) > 0 ? piquantAvg - 0.1 : 0, (piquantAvg + 0.1) < 1 ? piquantAvg + 0.1 : 1]
      }
      resolve(userFlavorPrefs);
    });
  })
  
};

module.exports = {


  createRecipes: function (queryModel, userid) {

    return new Promise(function(resolve, reject){

      //queries takes form of
      //{
      //  breakfastQuery: "...",
      //  lunchQuery: "...",
      //  dinnerQuery: "..."
      //}
      getUserFlavorPrefs(userid).then(function(userFlavorPrefs){
        console.log("getUserFlavorPrefs results: ", userFlavorPrefs);
      });
      
      var queries = writeQueries(queryModel);
      //if course has 0 meals, that query will result in empty string
      //var queries = writeQueries(queryModel, userFlavorPrefs);

      Promise.all([
        queryYummly(queries.breakfastQuery),
        queryYummly(queries.lunchQuery),
        queryYummly(queries.dinnerQuery)
      ])
      .then(function(results){
        //resolved value will be empty array if empty string is passed in
        var breakfasts = results[0] || results[0].matches;
        var lunches = results[1] || results[1].matches;
        var dinners = results[2] || results[2].matches;
        resolve({
          'breakfastRecipes': breakfasts,
          'lunchRecipes': lunches,
          'dinnerRecipes': dinners
        });

      })
      .catch(function(error){
        reject({'error': error});
      });
    });
  },

  //optimization note: lookup in database for preexisting recipes
  //potentially save two separate ids for recipes
  //matchId -> id from yummly match
  //getId -> id from individual get request
  getMealPlanRecipes: function(body){

    var recipeObject = {
      "breakfast": utils.parseRecipeIds(body.breakfastRecipes),
      "lunch": utils.parseRecipeIds(body.lunchRecipes),
      "dinner": utils.parseRecipeIds(body.dinnerRecipes)
    };

    return new Promise(function(resolve, reject){

      Promise.props({
        'breakfast': fetchRecipesByIds(recipeObject.breakfast),
        'lunch': fetchRecipesByIds(recipeObject.lunch),
        'dinner': fetchRecipesByIds(recipeObject.dinner)
      })
      .then(function(mealPlanRecipes){
        resolve(mealPlanRecipes);
      })
      .catch(function(error){
        reject({'error in getMealPlanRecipes': error});
      })
    })
  },
  saveRecipeArray: function(recipeArray, course){
    return new Promise(function(resolve, reject){
      var promises = [];
      for(var i = 0; i < recipeArray.length; i++){
        promises.push(saveRecipe(recipeArray[i], course))
      }

      Promise.all(promises)
      .then(function(){
        resolve();
      })
      .catch(function(error){
        reject({'error saving recipe array': error});
      })
    });
  },
  createIngredientsList: function (request, response) {
    if (!request.body.mealPlanId) {
      response.status(404).send({error: "Meal plan not found!"});
    }
    var mealPlanId = request.body.mealPlanId;

    new MealPlan({id: mealPlanId}).fetch({withRelated: 'recipes'}).then(function(model){
      var ingredients = [];
      model.related('recipes').forEach(function(item){
        var recipeIngredients = item.get('ingredients');
        recipeIngredients = recipeIngredients.split('|');
        console.log('recipe ingredients after split', recipeIngredients);
        ingredients = ingredients.concat(recipeIngredients);
      });
      response.status(200).send(ingredients);
    })
    .catch(function(error) {
      response.status(404).send({error: "Meal plan not found!"});
    });
  }
};

